#!/usr/bin/env node
// A calendar invite as a file, for owners whose Mac is not connected: the assistant sends it in
// the thread and anyone taps it to add the meeting. The model passes the facts; this script does
// the parts a model gets wrong: the time zone, the conversion to UTC, the weekday, the format.
// Prints ONE JSON line with the file path, the resolved times in words, and the MEDIA line to
// reply with, so the agent copies instead of composing.
//
//   node invite.mjs --title "Lunch: Sam / Patrick" --date 2026-10-01 --time 12:00 --minutes 60 \
//     --tz America/Los_Angeles --where "Verve Coffee, Palo Alto" --organizer "Sam" \
//     [--attendee "Patrick <psalyer@mayfield.com>"]... [--out /var/lib/plow/workspace/invites]
//
// RFC 5545, one VEVENT, times in UTC (Z), so every calendar shows the right local time.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const argv = process.argv.slice(2);
// Every flag this script reads. An unknown one used to be ignored in silence: the red-team run passed
// --recurring, --video and --email, got a plain one-off file, and told the guest it was all set.
const KNOWN = new Set(['title', 'what', 'date', 'time', 'minutes', 'tz', 'where', 'organizer', 'attendee', 'out', 'contact']);
const unknown = argv.filter((a) => a.startsWith('--') && !KNOWN.has(a.slice(2)));
const one = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const many = (k) => argv.flatMap((a, i) => (a === `--${k}` ? [argv[i + 1]] : []));
const fail = (msg) => { console.log(JSON.stringify({ ok: false, error: msg })); process.exit(1); };

// The owner's settings fill what the model leaves out: a missing --tz used to mean UTC, and
// "10:00" for a Los Angeles owner became 3 am.
let cfg = {};
try { cfg = JSON.parse(readFileSync(process.env.ONBEHALF_CONFIG || '/var/lib/plow/workspace/onbehalf.json', 'utf8')); } catch { /* flags only */ }
const title = one('title') || one('what'), date = one('date'), time = one('time'), tz = one('tz') || cfg.timezone || 'UTC';
const minutes = Number(one('minutes') || 60), where = one('where') || '', organizer = one('organizer') || cfg.owner || '';
const out = one('out') || process.env.ONBEHALF_INVITES || '/var/lib/plow/workspace/invites';
if (unknown.length) fail(`unknown flag ${unknown.join(', ')}: this script makes ONE single event with an optional place and attendees. It cannot make a recurring series, a video link or send email; say so instead of claiming it.`);
if (!title) fail('--title is required');
if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) fail('--date must be YYYY-MM-DD');
if (!/^\d{1,2}:\d{2}$/.test(time || '')) fail('--time must be HH:MM (24 h, in --tz)');
if (!(minutes > 0 && minutes <= 24 * 60)) fail('--minutes must be between 1 and 1440');
try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { fail(`unknown time zone: ${tz}`); }

// No invite for a time nobody picked. The red-team run booked Ian's weekly 1:1 and Juan's coffee
// before either of them had answered. The pipeline page must hold the slot that was chosen, and by
// whom; this script books that slot and nothing else, then writes the file back on the page.
const contact = one('contact');
if (!contact) fail('--contact is required: the person on the pipeline page whose chosen slot this books');
const { resolve: findPage, set: setPage } = await import('./pipeline.mjs');
const slug = findPage(contact);
const { readFileSync: rf, existsSync: ex } = await import('node:fs');
const pagePath = join(process.env.ONBEHALF_WORKSPACE || '/var/lib/plow/workspace', 'pipeline', `${slug}.md`);
const chosen = ex(pagePath) ? (rf(pagePath, 'utf8').match(/^chosen: "([^"]*)"$/m) || [])[1] : undefined;
const wanted = `${date} ${time.padStart(5, '0')}`;
if (!chosen) fail(`no slot has been chosen for ${contact}. Book only after they (or the owner) pick one, then record it: pipeline.mjs set ${contact} --chosen "${wanted}" --chosen-by guest|owner`);
if (chosen !== wanted) fail(`${contact} picked ${chosen}, not ${wanted}. Book the slot that was picked.`);

// Wall-clock time in tz -> UTC instant, without a library: guess, measure the offset, correct.
function zonedToUtc(y, mo, d, h, mi, zone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const asZone = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asZone - guess));
}
const [y, mo, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
const start = zonedToUtc(y, mo, d, h, mi, tz), end = new Date(start.getTime() + minutes * 60000);
const stamp = (dt) => dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line) => line.length <= 74 ? line : line.match(/.{1,73}/g).join('\r\n ');

const attendees = many('attendee').map((a) => {
  const m = a.match(/^(.*?)\s*<([^>]+@[^>]+)>$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : (/@/.test(a) ? { name: '', email: a.trim() } : { name: a.trim(), email: '' });
});
const uid = `${randomUUID()}@onbehalf`;
const lines = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OnBehalf//Invite//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
  'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
  `SUMMARY:${esc(title)}`,
  ...(where ? [`LOCATION:${esc(where)}`] : []),
  `DESCRIPTION:${esc(`Set up by ${organizer ? organizer + "'s" : 'the'} assistant (OnBehalf).`)}`,
  ...attendees.filter((a) => a.email).map((a) => `ATTENDEE;CN=${esc(a.name || a.email)};ROLE=REQ-PARTICIPANT:mailto:${a.email}`),
  'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'END:VALARM',
  'END:VEVENT', 'END:VCALENDAR',
].map(fold);

mkdirSync(out, { recursive: true });
// (the page is updated after the file exists, below)
const file = join(out, `${date}-${time.replace(':', '')}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.ics`);
writeFileSync(file, lines.join('\r\n') + '\r\n');
await setPage(slug, { invite: file, note: `invite file made for ${wanted}` });

const inZone = (dt, zone) => dt.toLocaleString('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
console.log(JSON.stringify({
  ok: true, file,
  when: `${inZone(start, tz)} – ${end.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })}`,
  start_utc: start.toISOString(), end_utc: end.toISOString(),
  media_line: `MEDIA:${file}`,
  note: 'Reply in the thread with the one-line recap, then the media_line on its own line. Copy "when" as is; do not recompute it.',
}));
