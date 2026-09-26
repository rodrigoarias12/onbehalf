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
    api.on('before_prompt_build', (event, ctx) => {
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
      const owner = w.owner || 'your owner', me = w.assistant || 'the assistant';
      const room = isOwnerSession(ctx?.sessionKey) ? `your owner's private chat: talk to ${owner} plainly` : `a room with people other than ${owner}: write as ${me}, ${owner}'s assistant, ${owner} in the third person`;
      const lines = [
        `[OnBehalf facts, resolved by the system]`,
        `Owner: ${owner}. You sign as: ${me}, ${owner}'s assistant. Owner's time zone: ${tz}.`,
        w.windows ? `Owner's usual windows: ${w.windows}.` : null,
        w.calendar?.ics ? `Owner's calendar: connected (read-only). Free slots: node /opt/onbehalf/bin/freebusy.mjs --from <YYYY-MM-DD> --days <n> --minutes <length>; it prints labels to copy. You never see what is on the calendar, only when the owner is free.` : `Owner's calendar: not connected; use the usual windows and say they are unconfirmed.`,
        w.firstMessage ? `First message to a new person: ${w.firstMessage === 'show' ? "show it to the owner first" : 'send it'}.` : null,
        `Owner's language: ${lang}. Write to the owner in it; write to anyone else in the language they write in (the first message to a new person in the owner's language unless you know theirs).`,
        `Today is ${today} (${tz}). The next 14 days: ${next}.${nextLocal ? ` In ${lang}: ${nextLocal}.` : ''} Copy weekdays from these lists; never compute them.`,
        `This room: ${room}.`,
      ].filter(Boolean);
      return { prependContext: lines.join('\n') };
    });

    // 1. The reply of a turn that runs in someone else's room.
    api.on('before_agent_finalize', (event, ctx) => {
      // Dates are checked in every room, the owner's included: a wrong weekday misleads anyone.
      const bad = wrongWeekday(event?.lastAssistantMessage);
      if (bad) {
        log(`revise session=${ctx?.sessionKey} rule="weekday" phrase="${bad.phrase}" actual="${bad.actual}"`);
        const instruction = dateInstruction(bad);
        return { action: 'revise', reason: instruction, retry: { instruction, idempotencyKey: 'onbehalf-date', maxAttempts: 2 } };
      }
      if (process.env.ONBEHALF_GUARD_ALL !== '1' && isOwnerSession(ctx?.sessionKey ?? event?.sessionKey)) return;
      const hit = ownerVoice(event?.lastAssistantMessage);
      if (!hit) return;
      log(`revise session=${ctx?.sessionKey} rule="${hit.rule}" phrase="${hit.phrase}"`);
      const instruction = rewriteInstruction(hit, who(ctx?.workspaceDir));
      return { action: 'revise', reason: instruction, retry: { instruction, idempotencyKey: 'onbehalf-voice', maxAttempts: 2 } };
    });

    // 2. Tools that put words in front of someone else.
    api.on('before_tool_call', (event, ctx) => {
      const p = event?.params || {};
      let text = null;
      if (event?.toolName === 'plow_start_thread') text = p.body;
      else if (event?.toolName === 'message' && (p.action === undefined || p.action === 'send' || p.action === 'reply')) {
        // A send to the owner's own room is the assistant reporting to its owner.
        if (process.env.ONBEHALF_GUARD_ALL !== '1' && (p.target === 'plow-owner' || p.to === 'plow-owner')) return;
        text = p.message ?? p.text ?? p.body;
      }
      const bad = wrongWeekday(text);
      if (bad) { log(`block tool=${event.toolName} rule="weekday" phrase="${bad.phrase}"`); return { block: true, blockReason: `Not sent. ${dateInstruction(bad)}` }; }
      const hit = ownerVoice(text);
      if (!hit) return;
      log(`block tool=${event.toolName} rule="${hit.rule}" phrase="${hit.phrase}"`);
      return { block: true, blockReason: `Not sent. ${rewriteInstruction(hit, who(ctx?.workspaceDir))}` };
    });

    // 3. The last door: nothing in the owner's voice reaches a third-party room.
    api.on('message_sending', async (event, ctx) => {
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
