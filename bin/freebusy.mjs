#!/usr/bin/env node
// The owner's free time, from the calendar's private iCal address (Google Calendar: Settings ›
// your calendar › "Secret address in iCal format"). Read-only, no Mac, no OAuth. The model never
// reads the calendar: this script does, and returns only BUSY blocks without titles and the FREE
// slots inside the owner's windows, each already written with its weekday and date. What fills
// the owner's day never reaches the model, so it cannot leak it to anyone.
//
//   node freebusy.mjs --ics-url "https://calendar.google.com/calendar/ical/…/basic.ics" \
//     --tz America/Sao_Paulo --from 2026-09-28 --days 5 --windows "12:00-14:00,17:00-19:00" \
//     [--minutes 60] [--weekdays 1-5] [--lang pt-BR] [--ics-file local.ics]
//
// Handles: UTC and TZID times, all-day events, recurring events (DAILY/WEEKLY with BYDAY,
// INTERVAL, COUNT, UNTIL; MONTHLY/YEARLY by date), EXDATE, cancelled and transparent events.

import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
// Everything the owner set up comes from onbehalf.json, so the model only passes the range:
//   node freebusy.mjs --from 2026-09-28 --days 5 --minutes 60
// The calendar address is read here and never passes through the model's context.
let cfg = {};
try { cfg = JSON.parse(readFileSync(process.env.ONBEHALF_CONFIG || '/var/lib/plow/workspace/onbehalf.json', 'utf8')); } catch { /* flags only */ }
const DEFAULTS = { tz: cfg.timezone, lang: cfg.language, windows: cfg.hours, weekdays: cfg.workdays, 'ics-url': cfg.calendar?.ics };
const one = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : (DEFAULTS[k] ?? d); };
const out = (o) => { console.log(JSON.stringify(o)); process.exit(o.ok === false ? 1 : 0); };
const tz = one('tz', 'UTC'), lang = one('lang', 'en-US'), minutes = Number(one('minutes', 60));
const fromDate = one('from'), days = Number(one('days', 5));
const windows = (one('windows', '09:00-18:00')).split(',').map((w) => w.trim().split('-').map((t) => t.split(':').map(Number)));
const weekdays = (() => { const w = one('weekdays', '1-5'); if (w.includes('-')) { const [a, b] = w.split('-').map(Number); return new Set([...Array(b - a + 1)].map((_, i) => a + i)); } return new Set(w.split(',').map(Number)); })();
try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { out({ ok: false, error: `unknown time zone: ${tz}` }); }
if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate || '')) out({ ok: false, error: '--from must be YYYY-MM-DD (the first day to look at, in --tz)' });

// ---- time zones without a library -----------------------------------------------------------
export function zonedToUtc(y, mo, d, h, mi, s, zone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asZone = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return new Date(guess - (asZone - guess));
}
const partsIn = (date, zone) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(date).map((x) => [x.type, x.value]));

// ---- iCalendar parsing ------------------------------------------------------------------------
function unfold(text) { return text.replace(/\r?\n[ \t]/g, ''); }
function parseTime(value, params, fallbackZone) {
  // 20261001T150000Z | 20261001T120000 (TZID=…) | 20261001 (VALUE=DATE)
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { date: new Date(Date.UTC(+y, +mo - 1, +d)), allDay: true, ymd: [+y, +mo, +d] };
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
  const zone = params.TZID || fallbackZone;
  return { date: zonedToUtc(+y, +mo, +d, +h, +mi, +s, zone), allDay: false, local: [+y, +mo, +d, +h, +mi, +s], zone };
}
export function parseEvents(ics, fallbackZone) {
  const lines = unfold(ics).split(/\r?\n/);
  const events = []; let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (ev) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const [nameParams, value] = [line.slice(0, i), line.slice(i + 1)];
    const [name, ...rawParams] = nameParams.split(';');
    const params = Object.fromEntries(rawParams.map((p) => p.split('=')));
    if (name === 'DTSTART') ev.start = parseTime(value, params, fallbackZone);
    else if (name === 'DTEND') ev.end = parseTime(value, params, fallbackZone);
    else if (name === 'RRULE') ev.rrule = Object.fromEntries(value.split(';').map((kv) => kv.split('=')));
    else if (name === 'EXDATE') for (const v of value.split(',')) { const t = parseTime(v, params, fallbackZone); if (t) ev.exdates.push(t.date.getTime()); }
    else if (name === 'STATUS') ev.status = value;
    else if (name === 'TRANSP') ev.transp = value;
    else if (name === 'RECURRENCE-ID') ev.recurrenceId = parseTime(value, params, fallbackZone);
  }
  return events.filter((e) => e.start);
}
const DAYCODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// Occurrences of one event that overlap [rangeStart, rangeEnd), as {start, end} Dates.
export function occurrences(ev, rangeStart, rangeEnd) {
  const dur = ev.end ? ev.end.date - ev.start.date : (ev.start.allDay ? 864e5 : 0);
  const at = (d) => ({ start: d, end: new Date(d.getTime() + dur) });
  if (!ev.rrule) return (ev.start.date < rangeEnd && at(ev.start.date).end > rangeStart) ? [at(ev.start.date)] : [];
  const r = ev.rrule, freq = r.FREQ, interval = Number(r.INTERVAL || 1);
  const until = r.UNTIL ? parseTime(r.UNTIL, {}, ev.start.zone || 'UTC').date : null;
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const byday = r.BYDAY ? r.BYDAY.split(',').map((d) => DAYCODE.indexOf(d.slice(-2))) : null;
  const res = []; let n = 0;
  // Walk local calendar days from the first occurrence, rebuilding each instance at the same
  // local wall-clock time in its zone, so daylight-saving changes keep "9:00" at 9:00.
  const zone = ev.start.zone || 'UTC';
  const base = ev.start.local || (ev.start.ymd ? [...ev.start.ymd, 0, 0, 0] : null);
  const make = (y, mo, d) => ev.start.allDay ? new Date(Date.UTC(y, mo - 1, d)) : (base ? zonedToUtc(y, mo, d, base[3], base[4], base[5], zone) : new Date(Date.UTC(y, mo - 1, d, ev.start.date.getUTCHours(), ev.start.date.getUTCMinutes())));
  const startY = base ? base[0] : ev.start.date.getUTCFullYear(), startM = base ? base[1] : ev.start.date.getUTCMonth() + 1, startD = base ? base[2] : ev.start.date.getUTCDate();
  const day0 = Date.UTC(startY, startM - 1, startD);
  for (let k = 0; k < 3660; k++) {
    const cal = new Date(day0 + k * 864e5); const y = cal.getUTCFullYear(), mo = cal.getUTCMonth() + 1, d = cal.getUTCDate(), wd = cal.getUTCDay();
    let hit = false;
    if (freq === 'DAILY') hit = k % interval === 0;
    else if (freq === 'WEEKLY') { const week = Math.floor((k + (new Date(day0).getUTCDay() + 6) % 7) / 7); hit = week % interval === 0 && (byday ? byday.includes(wd) : wd === new Date(day0).getUTCDay()); }
    else if (freq === 'MONTHLY') hit = d === startD && ((y - startY) * 12 + (mo - startM)) % interval === 0;
    else if (freq === 'YEARLY') hit = d === startD && mo === startM && (y - startY) % interval === 0;
    if (!hit) continue;
    const s = make(y, mo, d);
    if (until && s > until) break;
    if (++n > count) break;
    if (s >= rangeEnd) break;
    if (ev.exdates.includes(s.getTime())) continue;
    const o = at(s); if (o.end > rangeStart) res.push(o);
  }
  return res;
}

// ---- main ------------------------------------------------------------------------------------
let ics;
if (one('ics-file')) ics = readFileSync(one('ics-file'), 'utf8');
else {
  const url = one('ics-url'); if (!url) out({ ok: false, error: 'no calendar connected: offer slots from the owner\'s windows instead, or ask the owner for the secret iCal address' });
  try {
    const r = await fetch(url.replace(/^webcal:/, 'https:'), { signal: AbortSignal.timeout(15000) });
    if (!r.ok) out({ ok: false, error: `the calendar address answered HTTP ${r.status}; ask the owner to copy the secret address again` });
    ics = await r.text();
  } catch (e) { out({ ok: false, error: `could not read the calendar address (${e.name})` }); }
}
if (!/BEGIN:VCALENDAR/.test(ics)) out({ ok: false, error: 'that address did not return a calendar (no BEGIN:VCALENDAR)' });

const [fy, fm, fd] = fromDate.split('-').map(Number);
const rangeStart = zonedToUtc(fy, fm, fd, 0, 0, 0, tz), rangeEnd = new Date(rangeStart.getTime() + days * 864e5 + 2 * 36e5);
const events = parseEvents(ics, tz).filter((e) => e.status !== 'CANCELLED' && e.transp !== 'TRANSPARENT');
// A moved instance (RECURRENCE-ID) replaces the original occurrence at that time.
const moved = new Set(events.filter((e) => e.recurrenceId).map((e) => e.recurrenceId.date.getTime()));
const busy = events.flatMap((e) => occurrences(e, rangeStart, rangeEnd).filter((o) => e.recurrenceId || !moved.has(o.start.getTime())))
  .sort((a, b) => a.start - b.start);

const fmtDay = (d, l) => d.toLocaleDateString(l, { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
const fmtTime = (d, l) => d.toLocaleTimeString(l, { hour: '2-digit', minute: '2-digit', timeZone: tz, hourCycle: /^en/.test(l) ? 'h12' : 'h23' });
const free = [];
for (let i = 0; i < days; i++) {
  const dayUtc = new Date(Date.UTC(fy, fm - 1, fd) + i * 864e5); const y = dayUtc.getUTCFullYear(), mo = dayUtc.getUTCMonth() + 1, d = dayUtc.getUTCDate();
  if (!weekdays.has(dayUtc.getUTCDay())) continue;
  for (const [[h1, m1], [h2, m2]] of windows) {
    let t = zonedToUtc(y, mo, d, h1, m1 || 0, 0, tz); const wEnd = zonedToUtc(y, mo, d, h2, m2 || 0, 0, tz);
    while (t.getTime() + minutes * 60000 <= wEnd.getTime()) {
      const e = new Date(t.getTime() + minutes * 60000);
      const clash = busy.find((b) => b.start < e && b.end > t);
      if (clash) { t = new Date(Math.max(clash.end.getTime(), t.getTime() + 15 * 60000)); t = new Date(Math.ceil(t.getTime() / 9e5) * 9e5); continue; }
      if (t > new Date()) free.push({ start: t.toISOString(), end: e.toISOString(), date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, time: t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }), label: `${fmtDay(t, lang)}, ${fmtTime(t, lang)}–${fmtTime(e, lang)}` });
      t = e;
    }
  }
}
out({
  ok: true, timezone: tz, from: fromDate, days, minutes,
  busy_count: busy.filter((b) => b.end > rangeStart && b.start < rangeEnd).length,
  free_count: free.length,
  free: free.slice(0, 12), truncated: free.length > 12,
  note: 'Offer 2-3 of these, copying the label as is. Busy blocks are counted, not described: never say what the owner is doing. Book with invite.mjs using the slot\'s date and time.',
});
