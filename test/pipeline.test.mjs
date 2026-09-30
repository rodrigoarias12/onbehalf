// node test/pipeline.test.mjs — one page per contact; a send is recorded only when Plow delivered
// it; what is due (nudges, hand back to the owner) is computed, not guessed.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.ONBEHALF_WORKSPACE = mkdtempSync(join(tmpdir(), 'onbehalf-pipe-'));
const { set, list, slugOf, parse, render } = await import('../bin/pipeline.mjs');

const t0 = Date.parse('2026-09-30T15:00:00Z'), h = 36e5;
const yes = async () => true, no = async () => false, down = async () => { throw new Error('x'); };

assert.equal(slugOf('Juan Pérez'), 'juan-perez');
let r = await set('juan', { contact: 'Juan', status: 'waiting_on_us', meeting: 'coffee, 60 min' }, { now: t0 });
assert.equal(r.status, 'waiting_on_us');
assert.equal((await set('juan', { status: 'sent' }, { now: t0 })).ok, false, '"sent" without a chat is refused');
r = await set('juan', { status: 'sent', chat: 'cht_j', proposed: 'Mon 9am; Tue 9am; Thu 9am' }, { now: t0, checkDelivery: no });
assert.equal(r.status, 'unverified', 'not delivered: recorded as unverified, never as sent');
assert.match(r.note, /may not have arrived/);
r = await set('juan', { status: 'sent' }, { now: t0, checkDelivery: down });
assert.equal(r.status, 'unverified', 'delivery unknown: unverified');
r = await set('juan', { status: 'sent' }, { now: t0, checkDelivery: yes });
assert.equal(r.status, 'sent');
assert.equal((await set('juan', { status: 'maybe' }, { now: t0 })).ok, false, 'unknown status refused');

// Due, from the clock: first nudge at 24 h, second at 48 h, then back to the owner.
const at = (hours) => list(t0 + hours * h).contacts.find((c) => c.slug === 'juan');
assert.equal(at(10).nudge_due, false);
assert.equal(at(25).nudge_due, true); assert.match(at(25).say, /nudge #1/);
await set('juan', { nudged: true, note: 'nudged' }, { now: t0 + 25 * h });
assert.equal(list(t0 + 30 * h).contacts[0].nudge_due, false, 'the clock restarts after a nudge');
assert.equal(list(t0 + 25 * h + 48 * h).contacts[0].nudge_due, true);
await set('juan', { nudged: true }, { now: t0 + 74 * h });
const back = list(t0 + 74 * h + 25 * h);
assert.equal(back.contacts[0].hand_back, true); assert.equal(back.waiting_on_owner, 1);

// The page: header fields plus a dated log, round-trips.
const page = parse(readFileSync(join(process.env.ONBEHALF_WORKSPACE, 'pipeline', 'juan.md'), 'utf8'));
assert.equal(page.contact, 'Juan'); assert.equal(page.chat, 'cht_j'); assert.equal(page.nudges, 2);
assert.match(page.log, /status → unverified \(Plow has not delivered it\)/);
assert.equal(render(parse(render(page))), render(page));
console.log('ok: sends recorded only when delivered; nudges at 24 h and 48 h, then back to the owner; pages round-trip');
