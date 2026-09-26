// node test/invite.test.mjs — the invite's times are the one thing that must never drift.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'invite-'));
const run = (...a) => JSON.parse(execFileSync('node', [new URL('../bin/invite.mjs', import.meta.url).pathname, ...a, '--out', dir], { encoding: 'utf8' }));
const pdt = run('--title', 'Lunch', '--date', '2026-10-01', '--time', '12:00', '--tz', 'America/Los_Angeles', '--attendee', 'Patrick <p@x.com>');
assert.equal(pdt.start_utc, '2026-10-01T19:00:00.000Z');
assert.match(pdt.when, /^Thu, Oct 1, 12:00 PM PDT/);
const ics = readFileSync(pdt.file, 'utf8');
assert.match(ics, /DTSTART:20261001T190000Z\r\n/); assert.match(ics, /DTEND:20261001T200000Z\r\n/); assert.match(ics, /mailto:p@x\.com/);
assert.equal(run('--title', 'After DST', '--date', '2026-11-02', '--time', '09:30', '--minutes', '30', '--tz', 'America/Los_Angeles').start_utc, '2026-11-02T17:30:00.000Z');
assert.equal(run('--title', 'BA', '--date', '2026-10-06', '--time', '15:00', '--tz', 'America/Argentina/Buenos_Aires').start_utc, '2026-10-06T18:00:00.000Z');
assert.equal(run('--title', 'SP', '--date', '2026-10-06', '--time', '15:00', '--tz', 'America/Sao_Paulo').start_utc, '2026-10-06T18:00:00.000Z');
assert.throws(() => run('--title', 'x', '--date', '2026-10-06', '--time', '15:00', '--tz', 'Mars/Olympus'));
console.log('ok: invite times (PDT, after the DST change, Buenos Aires, São Paulo) and a bad zone');
