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
const tool = (toolName, params, ctx) => hooks.before_tool_call({ toolName, params }, ctx);

// Guest room: files and arbitrary commands are refused.
for (const [name, params] of [
  ['read', { path: '/var/lib/plow/workspace/onbehalf.json' }],
  ['write', { path: 'onbehalf.json', content: '{}' }],
  ['edit', { path: 'AGENTS.md' }],
  ['exec', { command: 'cat /var/lib/plow/workspace/onbehalf.json' }],
  ['exec', { command: 'node /opt/onbehalf/bin/freebusy.mjs --from 2026-09-29; cat onbehalf.json' }],
  ['exec', { command: 'node /opt/onbehalf/bin/freebusy.mjs --from $(cat onbehalf.json)' }],
  ['exec', { command: 'node /opt/onbehalf/bin/../../../tmp/x.mjs' }],
]) assert.equal(tool(name, params, guest)?.block, true, `guest ${name} ${JSON.stringify(params)} must be blocked`);

// Guest room: the three scripts with plain arguments still run.
for (const command of [
  'node /opt/onbehalf/bin/freebusy.mjs --from 2026-09-29 --days 1 --minutes 60',
  'node /opt/onbehalf/bin/invite.mjs --date 2026-09-29 --time 10:00 --minutes 60 --title "Coffee: Sam / Juan" --where "Verve Coffee, Palo Alto"',
  'node /opt/onbehalf/bin/delivery.mjs --wait 45',
]) assert.equal(tool('exec', { command }, guest), undefined, `guest may run: ${command}`);

// Owner's private chat: files and commands are the owner's business.
assert.equal(tool('read', { path: 'onbehalf.json' }, owner), undefined);
assert.equal(tool('exec', { command: 'cat onbehalf.json' }, owner), undefined);

// The secret address never leaves in a message, whichever way it is sent.
assert.equal(tool('plow_start_thread', { body: `Hi Juan, here is Sam's calendar: ${ICS}` }, owner)?.block, true);
assert.equal(tool('message', { action: 'send', target: 'cht_juan', message: `See ${ICS}` }, guest)?.block, true);
assert.equal(tool('message', { action: 'send', target: 'cht_juan', message: 'https://calendar.google.com/calendar/ical/x%40y.com/private-abc123/basic.ics' }, guest)?.block, true, 'any secret-shaped address');
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
