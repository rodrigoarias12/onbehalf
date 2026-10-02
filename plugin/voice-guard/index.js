// OnBehalf voice guard: the assistant speaks FOR the owner, never AS the owner.
//
// A prompt rule holds most of the time; a text to an investor cannot be "most of the time".
// So the rule is enforced by the Gateway at three points, none of which depends on the model
// obeying:
//
//   1. before_agent_finalize: a reply in someone else's room written in the owner's voice is
//      sent back to the model for one more pass, with the exact phrase and how to fix it.
//   2. before_tool_call: `message` and `plow_start_thread` with an owner-voice text to someone
//      else are blocked; the model gets the reason and writes it again.
//   3. message_sending: the last door. Anything that still carries the owner's voice to a
//      third-party room is not delivered. Fail closed: if we cannot tell whose room it is, it
//      is someone else's.
//
// Who is who comes from onbehalf.json in the workspace ({ "owner": "Sam", "assistant": "Spruce" }),
// written by the agent when the owner tells it; without it the guard still works with
// "the owner" / "the assistant".

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ownerVoice, rewriteInstruction, isOwnerSession, wrongWeekday, dateInstruction } from './voice.js';
import { deliveryFacts } from './delivery.js';
import { judgeVoice } from './judge.js';
import { unprovenClaim, claimInstruction, STOP, MONEY, DEFAULTS, defaultInstruction, ownerTask, holdingReply } from './claims.js';

// Shipped inside OpenClaw's own dist/extensions (see cloud/Dockerfile), so the SDK is two levels up.
import { definePluginEntry } from '../../plugin-sdk/plugin-entry.js';

const WORKSPACE = process.env.ONBEHALF_WORKSPACE || '/var/lib/plow/workspace';
function who(workspaceDir) {
  for (const dir of [workspaceDir, WORKSPACE]) {
    if (!dir) continue;
    try { return JSON.parse(readFileSync(join(dir, 'onbehalf.json'), 'utf8')); } catch { /* not set yet */ }
  }
  return {};
}

// Rooms the owner has alone with the assistant, learned from where the owner's own turns run.
const ownerRooms = new Set();
// Plow: a room's participants tell whether anyone besides the owner is in it. Cached per room.
const roomCache = new Map();
async function isThirdPartyRoom(channelId, to) {
  if (!to) return true;
  if (ownerRooms.has(`${channelId}:${to}`)) return false;
  if (channelId === 'plow' && process.env.PLOW_API_BASE) {
    if (roomCache.has(to)) return roomCache.get(to);
    try {
      const r = await fetch(`${process.env.PLOW_API_BASE.replace(/\/$/, '')}/v1/chats/${encodeURIComponent(to)}`, {
        headers: { Authorization: `Bearer ${process.env.PLOW_AGENT_TOKEN || 'proxied'}` },
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const chat = await r.json();
        const others = (chat.participants || []).filter((p) =>
          !(p.type === 'agent' && p.relationship === 'self') && !(p.type === 'member' && p.role === 'owner'));
        const third = others.length > 0;
        roomCache.set(to, third);
        return third;
      }
    } catch { /* unknown: fail closed below */ }
  }
  const forced = process.env.ONBEHALF_OWNER_ROOMS?.split(',').map((s) => s.trim());
  if (forced?.includes(to)) return false;
  return true;
}

const log = (msg) => console.log(`[voice-guard] ${msg}`);

// The owner's voice in a message to someone else: the patterns first (instant, no network), then,
// only on Plow and only for what the patterns let through, the model's second opinion. Cached by
// text, because the same reply is checked at finalize and again when a tool sends it.
const judged = new Map();
async function ownerVoiceHit(text, w) {
  const hit = ownerVoice(text);
  if (hit || !process.env.PLOW_API_BASE || process.env.ONBEHALF_JUDGE === 'off' || typeof text !== 'string' || !text.trim()) return hit;
  if (!judged.has(text)) {
    judged.set(text, judgeVoice(text, w).then((v) => (v?.owner ? { rule: 'judge', phrase: v.phrase || text.slice(0, 80) } : null)));
    if (judged.size > 200) judged.delete(judged.keys().next().value);
  }
  return judged.get(text);
}

// "Next week" is a range, not a feeling: on a Wednesday, Thursday is still THIS week.
function weeks(now, tz) {
  const fmt = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(now));
  const mon = new Date(now.getTime() - ((dow + 6) % 7) * 864e5);
  const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const day = (k) => { const d = new Date(mon.getTime() + k * 864e5); return `${fmt(d)} (${iso(d)})`; };
  return `This week: ${day(0)} to ${day(6)}. Next week: ${day(7)} to ${day(13)}. "Next week" means only the second range: for it, freebusy.mjs --from ${iso(new Date(mon.getTime() + 7 * 864e5))} --days 5.`;
}

// What this conversation has actually done, from tool results, for the claim check. Per session.
const evidence = new Map();
const proof = (key) => evidence.get(key) || {};
function noteEvidence(event, ctx) {
  if (event?.error) return;
  const key = ctx?.sessionKey || 'unknown', ev = { ...proof(key) };
  const name = String(event?.toolName || ''), cmd = String(event?.params?.command ?? '');
  const out = JSON.stringify(event?.result ?? '');
  if (name === 'exec' && /\binvite\.mjs\b/.test(cmd) && /\\?"ok\\?":\s*true/.test(out)) ev.invite = Date.now();
  // A calendar write on the owner's Mac (Latch's google-workspace): a create/insert/update that returned.
  if (/calendar|event/i.test(name) && /creat|insert|update|patch|add/i.test(name + JSON.stringify(event?.params ?? '')) && !/error/i.test(out.slice(0, 200))) ev.calendar = Date.now();
  evidence.set(key, ev);
}
async function claimsOf(text, key) {
  const ev = proof(key);
  // A page confirmed in the last half hour also proves a booking (the owner relayed it, or a guest room did).
  try {
    const { list } = await import(`${process.env.ONBEHALF_BIN || '/opt/onbehalf/bin'}/pipeline.mjs`);
    if (list().contacts.some((c) => c.status === 'confirmed' && c.invite)) ev.confirmed = true;
  } catch { /* no pipeline: session evidence only */ }
  return unprovenClaim(text, ev) || ownerTask(text, who().owner);
}

// A guest wrote. Two things are recorded by code, never left to the model: "stop texting me" (the
// contact becomes do_not_contact and is never texted again) and a money question (it stays open in
// the pipeline until the owner answers it; a red-team run lost a SAFE question in one turn).
async function guestWrote(event, ctx) {
  const text = String(event?.content ?? '');
  const chat = ctx?.conversationId;
  if (!text || !chat) return;
  const stop = STOP.test(text), money = MONEY.test(text);
  if (!stop && !money) return;
  try {
    const { set, list, slugOf } = await import(`${process.env.ONBEHALF_BIN || '/opt/onbehalf/bin'}/pipeline.mjs`);
    const page = list().contacts.find((c) => c.chat === chat);
    const slug = page?.slug || slugOf(String(event?.from || chat));
    if (stop) await set(slug, { chat, status: 'do_not_contact', note: `asked not to be texted: "${text.slice(0, 80)}"` });
    if (money) await set(slug, { chat, open: text.slice(0, 160), note: 'a question for the owner (money), kept open' });
  } catch (e) { log(`pipeline guest note failed: ${e.message}`); }
}
async function stopped(chat) {
  try {
    const { list } = await import(`${process.env.ONBEHALF_BIN || '/opt/onbehalf/bin'}/pipeline.mjs`);
    return list().contacts.some((c) => c.chat === chat && c.status === 'do_not_contact');
  } catch { return false; }
}

// A thread the assistant opened is a contact in the pipeline, recorded by the system, not left to
// the model's memory. 45 s later Plow says whether the first text arrived: "sent" or "unverified".
async function recordThread(event) {
  if (event?.toolName !== 'plow_start_thread' || event.error) return;
  let res = event.result?.details;
  if (!res?.chat_uid) { try { res = JSON.parse(event.result?.content?.[0]?.text || '{}'); } catch { res = {}; } }
  const chat = res?.chat_uid, members = event.params?.members || [];
  if (!chat || !members.length) return;
  try {
    const { set, resolve } = await import(`${process.env.ONBEHALF_BIN || '/opt/onbehalf/bin'}/pipeline.mjs`);
    const slug = resolve(null, members[0]);
    await set(slug, { handle: members.join(', '), chat, proposed: String(event.params?.body || '').slice(0, 400), note: 'first text sent (recorded by the system)' }, { checkDelivery: async () => true });
    setTimeout(() => { set(slug, { status: 'sent', note: 'delivery checked 45 s after the send' }).catch(() => {}); }, Number(process.env.ONBEHALF_DELIVERY_WAIT_MS || 45000));
  } catch (e) { log(`pipeline record failed: ${e.message}`); }
}

// The pipeline, resolved for the owner's turn: who waits on whom, and what is due now. The model
// copies these lines; it never works out "has it been 24 hours" on its own.
async function pipelineLines() {
  try {
    const { list } = await import(`${process.env.ONBEHALF_BIN || '/opt/onbehalf/bin'}/pipeline.mjs`);
    const r = list();
    if (!r.contacts.length) return null;
    const open = r.contacts.filter((c) => !['confirmed', 'passed', 'do_not_contact'].includes(c.status));
    const stoppedNow = r.contacts.filter((c) => c.status === 'do_not_contact');
    if (!open.length && !r.open_questions.length && !stoppedNow.length) return null;
    return [`Scheduling pipeline (from pipeline/, computed; update it with pipeline.mjs set):`,
      ...open.map((c) => `- ${c.contact}: ${c.status}${c.meeting ? `, ${c.meeting}` : ''}${c.chosen ? `, picked ${c.chosen}` : ''} — ${c.say}.${c.nudge_due ? ' DUE NOW.' : ''}${c.hand_back ? ' DUE NOW: ask the owner.' : ''}`),
      ...(r.open_questions.length ? [`Questions only the owner can answer, still open (bring each up until answered; close with pipeline.mjs set <contact> --close <n>):`, ...r.open_questions.map((q) => `- ${q}`)] : []),
      ...stoppedNow.map((c) => `- ${c.contact} asked not to be texted. Never text them; tell the owner once.`)].join('\n');
  } catch { return null; }
}

// Delivery status for the owner's turn, read at most every 30 s: a busy chat is not an API storm.
let deliveryCache = { at: 0, text: null };
async function deliveryLine() {
  if (!process.env.PLOW_API_BASE) return null; // not on Plow (local Gateway): nothing to read
  if (Date.now() - deliveryCache.at < 30000) return deliveryCache.text;
  deliveryCache = { at: Date.now(), text: await deliveryFacts() };
  return deliveryCache.text;
}

// In a room with other people the assistant needs its scripts and nothing else. Whoever writes
// there cannot talk it into reading the workspace (onbehalf.json holds the calendar's secret
// address) or running anything else: this is enforced here, not asked of the model.
const SCRIPT = /^\s*node\s+\/opt\/onbehalf\/bin\/(?:freebusy|invite|delivery|pipeline)\.mjs(?:\s+[^;&|`$<>\\\n]*)?$/;
const FILE_TOOLS = new Set(['read', 'write', 'edit', 'apply_patch']);
// Other conversations are other people's. A red-team guest asked for "his cell" and got the owner's
// number, pulled by memory_search from a different chat. In a room with others: no memory, no other
// sessions. The owner is told through the message tool (target plow-owner), never by reading here.
const CROSS_ROOM_TOOLS = /^(?:memory_(?:search|get)|sessions_(?:search|history|list|send|spawn)|conversations_(?:list|send|turn))$/;
// The calendar's secret address, or anything shaped like one, never goes out to anyone.
function leaksCalendar(text, w) {
  if (!text) return false;
  if (w.calendar?.ics && text.includes(w.calendar.ics)) return true;
  return /calendar\/ical\/[^\s]*\/private-[0-9a-f]+/i.test(text);
}

export default definePluginEntry({
  id: 'voice-guard',
  name: 'OnBehalf voice guard',
  description: 'Messages to anyone but the owner are written by the assistant, never as the owner.',
  register(api) {
    // Learn the owner's private rooms: a turn in the owner's main session, from the owner.
    api.on('message_received', (event, ctx) => {
      if (ctx?.sessionKey && isOwnerSession(ctx.sessionKey) && ctx.conversationId) ownerRooms.add(`${ctx.channelId}:${ctx.conversationId}`);
      else if (ctx?.sessionKey) guestWrote(event, ctx);
    });

    // 0. Facts the model should not have to look up or compute: who is who, the room it is in,
    //    and today's date with its weekday. Delivered resolved on every turn, no tool call.
    api.on('before_prompt_build', async (event, ctx) => {
      const w = who(ctx?.workspaceDir);
      const tz = w.timezone || 'UTC';
      const now = new Date();
      const today = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz });
      const lang = w.language || 'en';
      const next = [...Array(14)].map((_, i) => new Date(now.getTime() + (i + 1) * 864e5).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz })).join(', ');
      let nextLocal = '';
      if (!/^en/i.test(lang)) {
        try { nextLocal = [...Array(14)].map((_, i) => new Date(now.getTime() + (i + 1) * 864e5).toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })).join(', '); } catch { /* unknown locale */ }
      }
      const owner = w.owner || '(not set yet)', me = w.assistant || '(not set yet)';
      const room = isOwnerSession(ctx?.sessionKey) ? `your owner's private chat: talk to ${owner} plainly` : `a room with people other than ${owner}: write as ${me}, ${owner}'s assistant, ${owner} in the third person`;
      const setUp = Boolean(w.owner), ownerRoom = isOwnerSession(ctx?.sessionKey);
      const delivery = ownerRoom ? await deliveryLine() : null;
      const pipeline = ownerRoom ? await pipelineLines() : null;
      const lines = [
        `[OnBehalf facts, resolved by the system]`,
        setUp ? null : ownerRoom
          ? `SETUP NOT DONE: this owner has not set you up yet. Whatever they wrote, follow "First conversation" in AGENTS.md: first look on their Mac through Plow Latch for their name, calendars and time zone, then send the welcome asking only what you could not find, in the language they wrote in. Do not ask how you can help.`
          : `Setup is not finished. Never send the welcome here and never ask this person about calendars or settings: say you will check with your owner.`,
        `Owner: ${owner}. You sign as: ${me}, ${owner}'s assistant. Owner's time zone: ${tz}.`,
        w.windows ? `Owner's usual windows: ${w.windows}.` : null,
        w.calendar?.mac ? `Owner's calendar: on their Mac through Plow Latch. Read every calendar on every account with google-workspace (owners-mac) for availability; holds and invites go there too, each approved on the Mac.`
          : w.calendar?.ics ? `Owner's calendar: connected (read-only). Free slots: node /opt/onbehalf/bin/freebusy.mjs --from <YYYY-MM-DD> --days <n> --minutes <length>; it prints labels to copy. You never see what is on the calendar, only when the owner is free.`
          : `Owner's calendar: not connected; use the usual windows and say they are unconfirmed. If the owner's Mac is connected through Plow Latch, use it instead.`,
        `Owner's meeting preferences: video ${w.video ? `by ${w.video}` : 'not set (ask once, the first time a video call comes up, and save it as "video"; never offer a default)'}; default length ${w.meeting_minutes ? `${w.meeting_minutes} min` : 'not set (30 min unless the ask says otherwise)'}; travel buffer for in-person ${w.travel_minutes ? `${w.travel_minutes} min each way` : 'not set (ask once, the first time an in-person meeting comes up)'}.`,
        `First message to a new person: ${w.firstMessage === 'show' ? 'show it to the owner first and wait for ok (the owner asked for this)' : 'send it directly. The owner chose autonomy; do not ask for approval of the text'}.`,
        `Owner's language: ${lang}. Write to the owner in it; write to anyone else in the language they write in (the first message to a new person in the owner's language unless you know theirs).`,
        `Now: ${now.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz })} (${tz}). Never offer or accept a time that has passed. To check one proposed time: freebusy.mjs --check "YYYY-MM-DD HH:MM" --minutes <n> (it says free, busy, outside_hours or past; outside the owner's hours is never "booked").`,
        `Today is ${today} (${tz}). The next 14 days: ${next}.${nextLocal ? ` In ${lang}: ${nextLocal}.` : ''} Copy weekdays from these lists; never compute them.`,
        weeks(now, tz),
        `This room: ${room}.`,
        delivery,
        pipeline,
      ].filter(Boolean);
      return { prependContext: lines.join('\n') };
    });

    // 1. The reply of a turn that runs in someone else's room.
    api.on('before_agent_finalize', async (event, ctx) => {
      // A claim without proof, in every room: the owner acts on "booked" as much as a guest does.
      const claim = await claimsOf(event?.lastAssistantMessage, ctx?.sessionKey);
      if (claim) {
        log(`revise session=${ctx?.sessionKey} rule="unproven ${claim.kind}" phrase="${claim.phrase}"`);
        const instruction = claimInstruction(claim);
        return { action: 'revise', reason: instruction, retry: { instruction, idempotencyKey: 'onbehalf-claim', maxAttempts: 2 } };
      }
      // A default offered on the owner's behalf (Sam's error #7), in the owner's own chat.
      const dflt = isOwnerSession(ctx?.sessionKey) && String(event?.lastAssistantMessage ?? '').match(DEFAULTS);
      if (dflt) {
        log(`revise session=${ctx?.sessionKey} rule="default offered" phrase="${dflt[0]}"`);
        const instruction = defaultInstruction(dflt[0]);
        return { action: 'revise', reason: instruction, retry: { instruction, idempotencyKey: 'onbehalf-default', maxAttempts: 2 } };
      }
      // Dates are checked in every room, the owner's included: a wrong weekday misleads anyone.
      const bad = wrongWeekday(event?.lastAssistantMessage);
      if (bad) {
        log(`revise session=${ctx?.sessionKey} rule="weekday" phrase="${bad.phrase}" actual="${bad.actual}"`);
        const instruction = dateInstruction(bad);
        return { action: 'revise', reason: instruction, retry: { instruction, idempotencyKey: 'onbehalf-date', maxAttempts: 2 } };
      }
      if (process.env.ONBEHALF_GUARD_ALL !== '1' && isOwnerSession(ctx?.sessionKey ?? event?.sessionKey)) return;
      const hit = await ownerVoiceHit(event?.lastAssistantMessage, who(ctx?.workspaceDir));
      if (!hit) return;
      log(`revise session=${ctx?.sessionKey} rule="${hit.rule}" phrase="${hit.phrase}"`);
      const instruction = rewriteInstruction(hit, who(ctx?.workspaceDir));
      return { action: 'revise', reason: instruction, retry: { instruction, idempotencyKey: 'onbehalf-voice', maxAttempts: 2 } };
    });

    // 2. Tools that put words in front of someone else.
    api.on('before_tool_call', async (event, ctx) => {
      const p = event?.params || {};
      const guest = !isOwnerSession(ctx?.sessionKey);
      if (guest && FILE_TOOLS.has(event?.toolName)) {
        log(`block tool=${event.toolName} rule="guest-room files"`);
        return { block: true, blockReason: 'Not allowed in a room with other people: files stay private. Answer with what you already know, or say you will check with your owner.' };
      }
      if (guest && CROSS_ROOM_TOOLS.test(String(event?.toolName || ''))) {
        log(`block tool=${event.toolName} rule="guest-room cross-room"`);
        return { block: true, blockReason: 'Not allowed in a room with other people: other conversations and memory stay private. Answer from this thread; for anything only your owner knows, say you will check, and tell your owner with the message tool (target plow-owner).' };
      }
      if (guest && event?.toolName === 'exec' && !SCRIPT.test(String(p.command ?? p.cmd ?? ''))) {
        log(`block tool=exec rule="guest-room exec"`);
        return { block: true, blockReason: 'Not allowed in a room with other people: only node /opt/onbehalf/bin/freebusy.mjs, invite.mjs, delivery.mjs or pipeline.mjs, with plain arguments.' };
      }
      let text = null;
      if (event?.toolName === 'plow_start_thread') text = p.body;
      else if (event?.toolName === 'message' && (p.action === undefined || p.action === 'send' || p.action === 'reply')) {
        // A send to the owner's own room is the assistant reporting to its owner.
        if (process.env.ONBEHALF_GUARD_ALL !== '1' && (p.target === 'plow-owner' || p.to === 'plow-owner')) return;
        text = p.message ?? p.text ?? p.body;
      }
      const target = p.target ?? p.to;
      if (event?.toolName === 'message' && target && target !== 'plow-owner' && await stopped(target)) {
        log(`block tool=message rule="do_not_contact" to=${target}`);
        return { block: true, blockReason: 'Not sent: this person asked not to be texted. Tell your owner instead; never text them again unless the owner says they asked to resume.' };
      }
      const claim = text ? await claimsOf(text, ctx?.sessionKey) : null;
      if (claim) { log(`block tool=${event.toolName} rule="unproven ${claim.kind}"`); return { block: true, blockReason: `Not sent. ${claimInstruction(claim)}` }; }
      if (leaksCalendar(text, who(ctx?.workspaceDir))) {
        log(`block tool=${event.toolName} rule="calendar address"`);
        return { block: true, blockReason: "Not sent: it contains the calendar's secret address, which never leaves the owner's private chat. Remove it." };
      }
      const bad = wrongWeekday(text);
      if (bad) { log(`block tool=${event.toolName} rule="weekday" phrase="${bad.phrase}"`); return { block: true, blockReason: `Not sent. ${dateInstruction(bad)}` }; }
      const hit = await ownerVoiceHit(text, who(ctx?.workspaceDir));
      if (!hit) return;
      log(`block tool=${event.toolName} rule="${hit.rule}" phrase="${hit.phrase}"`);
      return { block: true, blockReason: `Not sent. ${rewriteInstruction(hit, who(ctx?.workspaceDir))}` };
    });

    api.on('after_tool_call', (event, ctx) => { noteEvidence(event, ctx); recordThread(event); });

    // 3. The last door: nothing in the owner's voice reaches a third-party room.
    api.on('message_sending', async (event, ctx) => {
      // The last door for claims: a revise asked at finalize does not always get its second pass (a
      // turn with tools can end right after it). A guest gets a true holding reply instead of the
      // claim, and the withheld text waits for the owner in the pipeline; the owner gets the
      // message with a correction under it.
      const claimHit = await claimsOf(event?.content, ctx?.sessionKey ?? `room:${ctx?.conversationId}`);
      if (claimHit) {
        const third = await isThirdPartyRoom(ctx?.channelId, ctx?.conversationId ?? event?.to);
        const owner = who(ctx?.workspaceDir).owner || 'the owner';
        log(`replace channel=${ctx?.channelId} to=${ctx?.conversationId ?? event?.to} rule="unproven ${claimHit.kind}" phrase="${claimHit.phrase}"`);
        if (third) {
          try {
            const { set, list, slugOf } = await import(`${process.env.ONBEHALF_BIN || '/opt/onbehalf/bin'}/pipeline.mjs`);
            const chat = ctx?.conversationId ?? event?.to;
            const page = list().contacts.find((c) => c.chat === chat);
            await set(page?.slug || slugOf(String(chat)), { chat, open: `withheld (not true yet): "${String(event.content).slice(0, 120)}"` });
          } catch { /* the reply below still goes out */ }
          return { content: holdingReply(String(event.content), owner) };
        }
        return { content: `${event.content}\n\n(Correction from the system: "${claimHit.phrase}" is not true yet. ${claimInstruction(claimHit).split('. Say only')[0].replace(/^You wrote "[^"]*", but /, '')}.)` };
      }
      if (leaksCalendar(event?.content, who(ctx?.workspaceDir))) {
        const third = await isThirdPartyRoom(ctx?.channelId, ctx?.conversationId ?? event?.to);
        if (third) { log(`cancel rule="calendar address"`); return { cancel: true, cancelReason: "onbehalf: the calendar's secret address never leaves the owner's private chat" }; }
      }
      const hit = ownerVoice(event?.content);
      if (!hit) return;
      const third = process.env.ONBEHALF_GUARD_ALL === '1' || await isThirdPartyRoom(ctx?.channelId, ctx?.conversationId ?? event?.to);
      if (!third) return;
      log(`cancel channel=${ctx?.channelId} to=${ctx?.conversationId ?? event?.to} rule="${hit.rule}" phrase="${hit.phrase}"`);
      return { cancel: true, cancelReason: `onbehalf voice guard: "${hit.phrase}" is the owner's voice` };
    });

    log('ready: finalize, tool and delivery checks registered');
  },
});
