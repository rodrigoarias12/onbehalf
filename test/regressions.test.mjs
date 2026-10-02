// node test/regressions.test.mjs — every real failure (Sam's install, the red-team run) replayed
// against the Gateway hooks and the scripts. CI runs it; an image is promoted only on green
// (bin/promote.mjs checks). A new incident goes into regressions.json BEFORE its fix.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = new URL('..', import.meta.url).pathname;
const cases = JSON.parse(readFileSync(join(repo, 'test/regressions.json'), 'utf8'));

// The plugin, laid out as in the image, with a one-line stand-in for the OpenClaw SDK.
const root = mkdtempSync(join(tmpdir(), 'onbehalf-regr-'));
cpSync(join(repo, 'plugin/voice-guard'), join(root, 'extensions/voice-guard'), { recursive: true });
mkdirSync(join(root, 'plugin-sdk'));
writeFileSync(join(root, 'plugin-sdk/plugin-entry.js'), 'export const definePluginEntry = (e) => e;\n');
const ws = join(root, 'workspace'); mkdirSync(ws);
writeFileSync(join(ws, 'onbehalf.json'), JSON.stringify({ owner: 'Sam', assistant: 'Spruce', timezone: 'America/Los_Angeles' }));
process.env.ONBEHALF_WORKSPACE = ws;
process.env.ONBEHALF_BIN = join(repo, 'bin');
delete process.env.PLOW_API_BASE; // patterns only: the model judge is measured by measure-voice.mjs

const hooks = {};
(await import(join(root, 'extensions/voice-guard/index.js'))).default.register({ on: (n, f) => { hooks[n] = f; } });
const sessions = { owner: 'agent:onbehalf:main', guest: 'agent:onbehalf:plow:group:cht_regr' };

let n = 0;
for (const c of cases.replies) {
  const key = `${sessions[c.room]}:${c.id}`; // a fresh session each, so evidence never leaks between cases
  const sessionKey = c.room === 'owner' ? sessions.owner : key;
  if (c.evidence?.invite) hooks.after_tool_call({ toolName: 'exec', params: { command: 'node /opt/onbehalf/bin/invite.mjs --contact X' }, result: { content: [{ type: 'text', text: '{"ok":true}' }] } }, { sessionKey });
  const r = await hooks.before_agent_finalize({ lastAssistantMessage: c.reply }, { sessionKey, workspaceDir: ws });
  const why = r?.reason || '';
  const got = !r ? 'pass' : /^You wrote ".*", but /.test(why) ? 'claim' : /picks a preference for the owner/.test(why) ? 'default' : /written as if you were/.test(why) ? 'voice' : `other: ${why.slice(0, 60)}`;
  const ok = c.expect === 'pass_claims' ? got !== 'claim' : got === c.expect;
  assert.ok(ok, `${c.id} (${c.source}): expected ${c.expect}, got ${got}\n  reply: ${c.reply}`);
  n++;
}

for (const c of cases.guest_messages) {
  const chat = `cht_${c.id}`;
  await hooks.message_received({ content: c.text, from: `+1555${n}` }, { sessionKey: `agent:onbehalf:plow:group:${chat}`, conversationId: chat, channelId: 'plow' });
  await new Promise((r) => setTimeout(r, 30));
  const { list } = await import(join(repo, 'bin/pipeline.mjs'));
  const page = list().contacts.find((x) => x.chat === chat);
  if (c.expect.status) assert.equal(page?.status, c.expect.status, `${c.id}: "${c.text}" must set ${c.expect.status}`);
  if (c.expect.open) assert.ok(page?.open?.length, `${c.id}: "${c.text}" must stay open for the owner`);
  if (!c.expect.status && !c.expect.open) assert.equal(page, undefined, `${c.id}: a plain reply records nothing`);
  n++;
}
// And a do_not_contact chat can no longer be texted.
const blocked = await hooks.before_tool_call({ toolName: 'message', params: { action: 'send', target: 'cht_redteam-15-stop', message: 'Hi again! Sam asked me to follow up.' } }, { sessionKey: 'agent:onbehalf:plow:group:cht_redteam-15-stop' });
assert.equal(blocked?.block, true, 'a contact who said stop is never texted again'); n++;

// The last door: what still carries an unproven claim when it is sent. A guest gets a true holding
// reply in their language and the withheld text waits for the owner; the owner gets a correction.
for (const c of cases.last_door) {
  const chat = c.room === 'owner' ? 'cht_owner_room' : `cht_${c.id}`;
  if (c.room === 'owner') process.env.ONBEHALF_OWNER_ROOMS = chat; else delete process.env.ONBEHALF_OWNER_ROOMS;
  const r = await hooks.message_sending({ content: c.content, to: chat }, { channelId: 'plow', conversationId: chat, workspaceDir: ws });
  if (c.expect_content === null) assert.equal(r?.content, undefined, `${c.id}: a true message goes out untouched`);
  else assert.ok(String(r?.content || '').includes(c.expect_content), `${c.id}: got ${JSON.stringify(r)}`);
  if (c.expect_open) {
    const { list } = await import(join(repo, 'bin/pipeline.mjs'));
    assert.ok(list().contacts.find((x) => x.chat === chat)?.open?.some((q) => q.startsWith('withheld')), `${c.id}: the withheld text waits for the owner`);
  }
  n++;
}
delete process.env.ONBEHALF_OWNER_ROOMS;

// Tools a room with other people must not reach (other conversations, memory), and what stays allowed.
for (const c of cases.tools) {
  const r = await hooks.before_tool_call({ toolName: c.tool, params: c.params }, { sessionKey: c.room === 'owner' ? sessions.owner : `${sessions.guest}:${c.id}`, workspaceDir: ws });
  assert.equal(r?.block === true ? 'block' : 'pass', c.expect, `${c.id}: ${c.tool} in the ${c.room} room`);
  n++;
}

for (const c of cases.scripts) {
  const [script, ...args] = c.argv;
  const env = { ...process.env, ONBEHALF_CONFIG: '/nonexistent', ...(c.now ? { ONBEHALF_NOW: c.now } : {}) };
  let outp;
  try { outp = JSON.parse(execFileSync('node', [join(repo, 'bin', script), ...args], { cwd: repo, env, encoding: 'utf8', stdio: 'pipe' })); }
  catch (e) { outp = JSON.parse(e.stdout); }
  if (c.expect_error) assert.match(String(outp.error || ''), new RegExp(c.expect_error), `${c.id}: ${JSON.stringify(outp)}`);
  if (c.expect_verdict) assert.equal(outp.verdict, c.expect_verdict, `${c.id}: ${JSON.stringify(outp)}`);
  n++;
}
console.log(`ok: ${n} regression cases from real incidents (Sam's install and the red-team run) hold`);
