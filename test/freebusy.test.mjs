// node test/freebusy.test.mjs — free slots from a calendar with the cases that break naive code.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const bin = new URL('../bin/freebusy.mjs', import.meta.url).pathname, cal = new URL('./fixtures/calendar.ics', import.meta.url).pathname;
const r = JSON.parse(execFileSync('node', [bin, '--ics-file', cal, '--tz', 'America/Sao_Paulo', '--from', '2026-09-28', '--days', '5', '--windows', '12:00-14:00,17:00-19:00', '--minutes', '60', '--lang', 'pt-BR'], { encoding: 'utf8' }));
const slots = r.free.map((s) => `${s.date} ${s.time}`);
const expect = ['2026-09-28 13:00', '2026-09-28 17:00', '2026-09-29 13:00', '2026-09-29 17:00', '2026-09-29 18:00',
  '2026-10-01 12:00', '2026-10-01 13:00', '2026-10-01 17:00', '2026-10-01 18:00', '2026-10-02 12:00', '2026-10-02 13:00', '2026-10-02 17:00'];
assert.deepEqual(slots, expect);
assert.equal(r.free_count, 13); assert.equal(r.truncated, true);
assert.ok(!JSON.stringify(r).match(/lunch|therapy|Offsite|Board|Gym/i), 'no event titles may leave the script');
assert.match(r.free[0].label, /^segunda-feira, 28 de setembro, 13:00–14:00$/);
console.log('ok: UTC and TZID times, all-day, weekly with EXDATE, COUNT, cancelled, transparent; no titles; labels in pt-BR');
