// node test/invite.test.mjs — the invite's times are the one thing that must never drift, and an
// invite exists only for a slot somebody picked.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'invite-'));
const ws = mkdtempSync(join(tmpdir(), 'invite-ws-'));
const env = { ...process.env, ONBEHALF_WORKSPACE: ws, ONBEHALF_CONFIG: '/nonexistent' };
const bin = (s) => new URL(`../bin/${s}`, import.meta.url).pathname;
const run = (...a) => JSON.parse(execFileSync('node', [bin('invite.mjs'), ...a, '--out', dir], { encoding: 'utf8', env }));
const refuse = (...a) => { try { execFileSync('node', [bin('invite.mjs'), ...a, '--out', dir], { encoding: 'utf8', env, stdio: 'pipe' }); } catch (e) { return JSON.parse(e.stdout).error; } assert.fail(`should refuse: ${a.join(' ')}`); };
const pick = (who, slot, by = 'guest') => execFileSync('node', [bin('pipeline.mjs'), 'set', who, '--chosen', slot, '--chosen-by', by], { encoding: 'utf8', env });

// The gate: no contact, nothing chosen, or a different slot than the one picked → no file.
assert.match(refuse('--title', 'Lunch', '--date', '2026-10-01', '--time', '12:00'), /--contact is required/);
assert.match(refuse('--title', 'Lunch', '--date', '2026-10-01', '--time', '12:00', '--contact', 'Patrick'), /no slot has been chosen for Patrick/);
pick('Patrick', '2026-10-01 12:00');
assert.match(refuse('--title', 'Lunch', '--date', '2026-10-02', '--time', '12:00', '--contact', 'Patrick'), /picked 2026-10-01 12:00/);
// Unknown flags are refused, with what the script cannot do (a red-team run passed these and claimed a recurring Zoom invite).
assert.match(refuse('--title', 'Weekly', '--date', '2026-10-01', '--time', '12:00', '--contact', 'Patrick', '--recurring', 'weekly'), /cannot make a recurring series/);
assert.match(refuse('--title', 'x', '--date', '2026-10-01', '--time', '12:00', '--contact', 'Patrick', '--video', 'zoom'), /unknown flag --video/);

// Times: PDT, after the DST change, Buenos Aires, São Paulo, and a bad zone.
const pdt = run('--title', 'Lunch', '--date', '2026-10-01', '--time', '12:00', '--tz', 'America/Los_Angeles', '--attendee', 'Patrick <p@x.com>', '--contact', 'Patrick');
assert.equal(pdt.start_utc, '2026-10-01T19:00:00.000Z');
assert.match(pdt.when, /^Thu, Oct 1, 12:00 PM PDT/);
const ics = readFileSync(pdt.file, 'utf8');
assert.match(ics, /DTSTART:20261001T190000Z\r\n/); assert.match(ics, /DTEND:20261001T200000Z\r\n/); assert.match(ics, /mailto:p@x\.com/);
assert.match(readFileSync(join(ws, 'pipeline', 'patrick.md'), 'utf8'), /^invite: ".*\.ics"$/m, 'the file is recorded on the page');
pick('Dana', '2026-11-02 09:30', 'owner');
assert.equal(run('--title', 'After DST', '--date', '2026-11-02', '--time', '09:30', '--minutes', '30', '--tz', 'America/Los_Angeles', '--contact', 'Dana').start_utc, '2026-11-02T17:30:00.000Z');
pick('Mara', '2026-10-06 15:00');
assert.equal(run('--title', 'BA', '--date', '2026-10-06', '--time', '15:00', '--tz', 'America/Argentina/Buenos_Aires', '--contact', 'Mara').start_utc, '2026-10-06T18:00:00.000Z');
assert.equal(run('--title', 'SP', '--date', '2026-10-06', '--time', '15:00', '--tz', 'America/Sao_Paulo', '--contact', 'Mara').start_utc, '2026-10-06T18:00:00.000Z');
assert.match(refuse('--title', 'x', '--date', '2026-10-06', '--time', '15:00', '--tz', 'Mars/Olympus', '--contact', 'Mara'), /unknown time zone/);
console.log('ok: no invite without a picked slot or with unknown flags; times in PDT, after DST, Buenos Aires, São Paulo; a bad zone');
