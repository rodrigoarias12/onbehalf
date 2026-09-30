// node test/guard.test.mjs — the Gateway hooks themselves, not the model: in a room with other
// people nothing reads the workspace, only the three scripts run, and the calendar's secret
// address never goes out. The plugin imports the OpenClaw SDK from two levels up, so the test
// lays it out the way the image does, with a one-line stand-in for the SDK.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'onbehalf-guard-'));
cpSync(new URL('../plugin/voice-guard', import.meta.url).pathname, join(root, 'extensions/voice-guard'), { recursive: true });
mkdirSync(join(root, 'plugin-sdk'));
writeFileSync(join(root, 'plugin-sdk/plugin-entry.js'), 'export const definePluginEntry = (e) => e;\n');
const ws = join(root, 'workspace'); mkdirSync(ws);
const ICS = 'https://calendar.google.com/calendar/ical/sam%40gmail.com/private-0123456789abcdef/basic.ics';
writeFileSync(join(ws, 'onbehalf.json'), JSON.stringify({ owner: 'Sam', assistant: 'Spruce', timezone: 'America/Los_Angeles', calendar: { ics: ICS } }));
delete process.env.PLOW_API_BASE; // no Plow here: the facts block must not try the network

const hooks = {};
const plugin = (await import(join(root, 'extensions/voice-guard/index.js'))).default;
plugin.register({ on: (name, fn) => { hooks[name] = fn; } });

const guest = { sessionKey: 'agent:onbehalf:plow:group:cht_juan', workspaceDir: ws };
const owner = { sessionKey: 'agent:onbehalf:main', workspaceDir: ws };
const tool = (toolName, params, ctx) => hooks.before_tool_call({ toolName, params }, ctx); // async: the judge may run

// Guest room: files and arbitrary commands are refused.
for (const [name, params] of [
  ['read', { path: '/var/lib/plow/workspace/onbehalf.json' }],
  ['write', { path: 'onbehalf.json', content: '{}' }],
  ['edit', { path: 'AGENTS.md' }],
  ['exec', { command: 'cat /var/lib/plow/workspace/onbehalf.json' }],
  ['exec', { command: 'node /opt/onbehalf/bin/freebusy.mjs --from 2026-09-29; cat onbehalf.json' }],
  ['exec', { command: 'node /opt/onbehalf/bin/freebusy.mjs --from $(cat onbehalf.json)' }],
  ['exec', { command: 'node /opt/onbehalf/bin/../../../tmp/x.mjs' }],
]) assert.equal((await tool(name, params, guest))?.block, true, `guest ${name} ${JSON.stringify(params)} must be blocked`);

// Guest room: the three scripts with plain arguments still run.
for (const command of [
  'node /opt/onbehalf/bin/freebusy.mjs --from 2026-09-29 --days 1 --minutes 60',
  'node /opt/onbehalf/bin/invite.mjs --date 2026-09-29 --time 10:00 --minutes 60 --title "Coffee: Sam / Juan" --where "Verve Coffee, Palo Alto"',
  'node /opt/onbehalf/bin/delivery.mjs --wait 45',
  'node /opt/onbehalf/bin/pipeline.mjs set juan --status confirmed --note "Juan picked Thu 9am"',
]) assert.equal(await tool('exec', { command }, guest), undefined, `guest may run: ${command}`);

// Owner's private chat: files and commands are the owner's business.
assert.equal(await tool('read', { path: 'onbehalf.json' }, owner), undefined);
assert.equal(await tool('exec', { command: 'cat onbehalf.json' }, owner), undefined);

// The secret address never leaves in a message, whichever way it is sent.
assert.equal((await tool('plow_start_thread', { body: `Hi Juan, here is Sam's calendar: ${ICS}` }, owner))?.block, true);
assert.equal((await tool('message', { action: 'send', target: 'cht_juan', message: `See ${ICS}` }, guest))?.block, true);
assert.equal((await tool('message', { action: 'send', target: 'cht_juan', message: 'https://calendar.google.com/calendar/ical/x%40y.com/private-abc123/basic.ics' }, guest))?.block, true, 'any secret-shaped address');
const cancelled = await hooks.message_sending({ content: `link: ${ICS}`, to: 'cht_juan' }, { channelId: 'plow', conversationId: 'cht_juan', workspaceDir: ws });
assert.equal(cancelled?.cancel, true, 'last door: an unknown room is a third-party room');

// Setup not finished: the welcome (which asks for the calendar) is for the owner only.
const empty = join(root, 'empty'); mkdirSync(empty);
const factsGuest = (await hooks.before_prompt_build({}, { ...guest, workspaceDir: empty })).prependContext;
const factsOwner = (await hooks.before_prompt_build({}, { ...owner, workspaceDir: empty })).prependContext;
assert.doesNotMatch(factsGuest, /SETUP NOT DONE/);
assert.match(factsGuest, /never ask this person about calendars/);
assert.match(factsOwner, /SETUP NOT DONE/);

console.log('ok: guest rooms read no files and run only the three scripts; the calendar address never goes out; the welcome is for the owner');

// The judge: what the patterns let through goes to the model; its "owner voice" blocks the send,
// its "assistant" lets it go, and when it cannot answer the patterns' verdict stands (fail open).
{
  process.env.PLOW_API_BASE = 'http://judge.test';
  const realFetch = globalThis.fetch;
  let mode = 'owner', calls = 0;
  globalThis.fetch = async (url) => {
    if (!String(url).endsWith('/v1/chat/completions')) return realFetch(url);
    calls++;
    if (mode === 'down') throw new Error('unreachable');
    const content = JSON.stringify({ owner_voice: mode === 'owner', phrase: mode === 'owner' ? 'Tô dentro' : '' });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  const send = (message) => tool('message', { action: 'send', target: 'cht_juan', message }, guest);
  mode = 'owner'; assert.equal((await send('Tô dentro'))?.block, true, 'judge says owner voice: blocked');
  mode = 'assistant'; assert.equal(await send('Sam topa quinta, eu mando o convite'), undefined, 'judge says assistant: sent');
  mode = 'down'; assert.equal(await send('Beleza, sexta então'), undefined, 'judge unreachable: the patterns decide');
  const before = calls; mode = 'owner';
  assert.equal((await send("I'm free Tuesday"))?.block, true); assert.equal(calls, before, 'the patterns catch it: no model call');
  globalThis.fetch = realFetch; delete process.env.PLOW_API_BASE;
  console.log('ok: the judge blocks what the patterns miss, lets the assistant through, and fails open');
}

// The system, not the model, records a thread the assistant opened, then its delivery.
{
  const { mkdtempSync: mk } = await import('node:fs');
  process.env.ONBEHALF_BIN = new URL('../bin', import.meta.url).pathname;
  process.env.ONBEHALF_WORKSPACE = mk(join(tmpdir(), 'onbehalf-rec-'));
  process.env.ONBEHALF_DELIVERY_WAIT_MS = '20';
  process.env.PLOW_API_BASE = 'http://plow.test';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/v1/chats?limit=50')) return new Response(JSON.stringify({ data: [{ uid: 'cht_new', participants: [{ type: 'agent', relationship: 'self' }, { type: 'member', role: 'owner' }, { type: 'member', role: 'member', provider_key: '+16505550199', display_name: '+16505550199' }] }] }));
    if (u.includes('/v1/chats/cht_new/messages')) return new Response(JSON.stringify({ data: [{ direction: 'outbound', status: 'delivered', created_at: new Date().toISOString(), body: 'Hi Patrick, this is Spruce' }] }));
    return realFetch(url);
  };
  hooks.after_tool_call({ toolName: 'plow_start_thread', params: { members: ['+16505550199'], body: 'Hi Patrick, this is Spruce, Sam’s assistant.' }, result: { details: { chat_uid: 'cht_new', message_sent: true } } }, {});
  await new Promise((r) => setTimeout(r, 300));
  const { resolve, list } = await import('../bin/pipeline.mjs');
  const c = list().contacts.find((x) => x.slug === resolve(null, '+16505550199'));
  assert.ok(c, 'the thread is in the pipeline without the model doing anything');
  assert.equal(c.status, 'sent', 'and marked sent only after Plow reported it delivered');
  const facts = (await hooks.before_prompt_build({}, owner)).prependContext;
  assert.match(facts, /Next week: Mon, /);
  assert.match(facts, /Scheduling pipeline/);
  globalThis.fetch = realFetch; delete process.env.PLOW_API_BASE;
  console.log('ok: an opened thread is recorded by the system and marked sent once delivered; facts carry the weeks and the pipeline');
}
