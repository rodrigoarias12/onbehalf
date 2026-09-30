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
const SCRIPT = /^\s*node\s+\/opt\/onbehalf\/bin\/(?:freebusy|invite|delivery)\.mjs(?:\s+[^;&|`$<>\\\n]*)?$/;
const FILE_TOOLS = new Set(['read', 'write', 'edit', 'apply_patch']);
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
      const lines = [
        `[OnBehalf facts, resolved by the system]`,
        setUp ? null : ownerRoom
          ? `SETUP NOT DONE: this owner has not set you up yet. Whatever they wrote, reply with the welcome message from "First conversation" in AGENTS.md, in the language they wrote in. Do not ask how you can help.`
          : `Setup is not finished. Never send the welcome here and never ask this person about calendars or settings: say you will check with your owner.`,
        `Owner: ${owner}. You sign as: ${me}, ${owner}'s assistant. Owner's time zone: ${tz}.`,
        w.windows ? `Owner's usual windows: ${w.windows}.` : null,
        w.calendar?.ics ? `Owner's calendar: connected (read-only). Free slots: node /opt/onbehalf/bin/freebusy.mjs --from <YYYY-MM-DD> --days <n> --minutes <length>; it prints labels to copy. You never see what is on the calendar, only when the owner is free.` : `Owner's calendar: not connected; use the usual windows and say they are unconfirmed.`,
        w.firstMessage ? `First message to a new person: ${w.firstMessage === 'show' ? "show it to the owner first" : 'send it'}.` : null,
        `Owner's language: ${lang}. Write to the owner in it; write to anyone else in the language they write in (the first message to a new person in the owner's language unless you know theirs).`,
        `Today is ${today} (${tz}). The next 14 days: ${next}.${nextLocal ? ` In ${lang}: ${nextLocal}.` : ''} Copy weekdays from these lists; never compute them.`,
        `This room: ${room}.`,
        delivery,
      ].filter(Boolean);
      return { prependContext: lines.join('\n') };
    });

    // 1. The reply of a turn that runs in someone else's room.
    api.on('before_agent_finalize', async (event, ctx) => {
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
      if (guest && event?.toolName === 'exec' && !SCRIPT.test(String(p.command ?? p.cmd ?? ''))) {
        log(`block tool=exec rule="guest-room exec"`);
        return { block: true, blockReason: 'Not allowed in a room with other people: only node /opt/onbehalf/bin/freebusy.mjs, invite.mjs or delivery.mjs, with plain arguments.' };
      }
      let text = null;
      if (event?.toolName === 'plow_start_thread') text = p.body;
      else if (event?.toolName === 'message' && (p.action === undefined || p.action === 'send' || p.action === 'reply')) {
        // A send to the owner's own room is the assistant reporting to its owner.
        if (process.env.ONBEHALF_GUARD_ALL !== '1' && (p.target === 'plow-owner' || p.to === 'plow-owner')) return;
        text = p.message ?? p.text ?? p.body;
      }
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

    // 3. The last door: nothing in the owner's voice reaches a third-party room.
    api.on('message_sending', async (event, ctx) => {
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
