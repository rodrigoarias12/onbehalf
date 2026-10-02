#!/usr/bin/env node
// Who is waiting on whom. One page per contact in the workspace (pipeline/<slug>.md): a small
// header with the fields below and, under it, a dated log in plain prose. The model never keeps
// this in its head: it reads `list` and writes with `set`, and this script does the parts a
// model gets wrong — the clock, the arithmetic of "how long has it been", and refusing to record
// a send that did not happen.
//
//   node pipeline.mjs list                       # every contact, with what is due, resolved
//   node pipeline.mjs show <slug>
//   node pipeline.mjs set <slug> --status sent --chat cht_… [--contact "Juan"] [--handle +1…]
//        [--proposed "…"] [--meeting "coffee, 60 min, in person"] [--next "…"] [--note "…"]
//
// Statuses (Sam's scheduling spec): new · waiting_on_us · held · sent · waiting_on_them ·
// confirmed · passed · do_not_contact, plus unverified: a send we could not confirm.
// `sent` and `waiting_on_them` are recorded only if Plow reports the last text in that chat as
// delivered. Otherwise the page says `unverified`, and the owner is told the truth.

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const STATUSES = ['new', 'waiting_on_us', 'held', 'sent', 'waiting_on_them', 'confirmed', 'passed', 'do_not_contact', 'unverified'];
const FIELDS = ['contact', 'handle', 'chat', 'status', 'meeting', 'proposed', 'chosen', 'chosen_by', 'invite', 'holds', 'open', 'next_step', 'nudges', 'updated'];
const NEEDS_DELIVERY = new Set(['sent', 'waiting_on_them']);
const NUDGE_AFTER_H = [24, 48]; // two nudges, then back to the owner

const dir = () => join(process.env.ONBEHALF_WORKSPACE || '/var/lib/plow/workspace', 'pipeline');
export const slugOf = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'contact';

export function parse(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const page = { log: m ? m[2].trim() : text.trim() };
  for (const line of (m ? m[1] : '').split('\n')) {
    const k = line.slice(0, line.indexOf(':')).trim();
    if (FIELDS.includes(k)) page[k] = JSON.parse(line.slice(line.indexOf(':') + 1).trim() || '""');
  }
  return page;
}
export function render(page) {
  const head = FIELDS.filter((k) => page[k] !== undefined && page[k] !== '').map((k) => `${k}: ${JSON.stringify(page[k])}`);
  return `---\n${head.join('\n')}\n---\n${page.log ? page.log.trim() + '\n' : ''}`;
}
const read = (slug) => existsSync(join(dir(), `${slug}.md`)) ? parse(readFileSync(join(dir(), `${slug}.md`), 'utf8')) : null;
const write = (slug, page) => { mkdirSync(dir(), { recursive: true }); writeFileSync(join(dir(), `${slug}.md`), render(page)); };

/** What is due, computed: the model copies these words, it does not work them out. */
export function due(page, now = Date.now()) {
  const hours = page.updated ? Math.floor((now - Date.parse(page.updated)) / 36e5) : null;
  const nudges = Number(page.nudges || 0);
  const out = { waiting_hours: hours, on_owner: false, nudge_due: false, hand_back: false, say: '' };
  switch (page.status) {
    case 'new': case 'waiting_on_us': out.on_owner = true; out.say = `waiting on us for ${hours ?? '?'} h`; break;
    case 'unverified': out.on_owner = true; out.say = 'a text we could not confirm: tell the owner, do not assume it arrived'; break;
    case 'sent': case 'waiting_on_them': {
      if (hours !== null && nudges < NUDGE_AFTER_H.length && hours >= NUDGE_AFTER_H[nudges]) { out.nudge_due = true; out.say = `no answer after ${hours} h: nudge #${nudges + 1}, as the assistant`; }
      else if (hours !== null && nudges >= NUDGE_AFTER_H.length && hours >= 24) { out.hand_back = true; out.on_owner = true; out.say = `no answer after ${nudges} nudges: ask the owner whether to keep trying`; }
      else out.say = `waiting on them for ${hours ?? '?'} h`;
      break;
    }
    case 'held': out.on_owner = true; out.say = 'times held, proposal not sent yet'; break;
    default: out.say = page.status || 'no status';
  }
  return out;
}

export function list(now = Date.now()) {
  if (!existsSync(dir())) return { contacts: [], waiting_on_owner: 0, nudges_due: 0 };
  const contacts = readdirSync(dir()).filter((f) => f.endsWith('.md')).map((f) => {
    const slug = f.slice(0, -3), page = read(slug);
    return { slug, contact: page.contact || slug, chat: page.chat || '', status: page.status, meeting: page.meeting || '', proposed: page.proposed || '', chosen: page.chosen || '', invite: page.invite || '', open: page.open || [], next_step: page.next_step || '', ...due(page, now) };
  });
  return { contacts, waiting_on_owner: contacts.filter((c) => c.on_owner || c.open.length).length, nudges_due: contacts.filter((c) => c.nudge_due).length, open_questions: contacts.flatMap((c) => c.open.map((q) => `${c.contact}: ${q}`)) };
}

async function delivered(chat) {
  const { deliveryReport } = await import('../plugin/voice-guard/delivery.js');
  const r = await deliveryReport({ sinceMin: 7 * 24 * 60 });
  const p = r.people.find((x) => x.chat === chat);
  return p ? p.arrived : null;
}

/** The page for a contact: by handle first (the system opens pages by phone number), then by name. */
export function resolve(who, handle) {
  const digits = (s) => String(s || '').replace(/[^\d]/g, '');
  if (existsSync(dir())) for (const f of readdirSync(dir()).filter((x) => x.endsWith('.md'))) {
    const p = read(f.slice(0, -3));
    if ((handle && digits(p.handle) && digits(p.handle).includes(digits(handle))) || (who && digits(who).length > 6 && digits(p.handle).includes(digits(who)))) return f.slice(0, -3);
    if (who && String(p.contact || '').toLowerCase() === String(who).toLowerCase()) return f.slice(0, -3);
  }
  return slugOf(handle && !who ? handle : who);
}

export async function set(slug, opts, { now = Date.now(), checkDelivery = delivered } = {}) {
  const page = read(slug) || { contact: opts.contact || slug, log: '' };
  for (const k of ['contact', 'handle', 'chat', 'meeting', 'proposed', 'holds', 'invite']) if (opts[k] !== undefined) page[k] = opts[k];
  // The slot the guest (or the owner) actually picked, "YYYY-MM-DD HH:MM": invite.mjs books only this.
  if (opts.chosen !== undefined) {
    const c = String(opts.chosen).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/);
    if (!c) return { ok: false, error: '--chosen must be "YYYY-MM-DD HH:MM", the exact slot that was picked' };
    if (!['guest', 'owner'].includes(opts['chosen-by'])) return { ok: false, error: '--chosen needs --chosen-by guest|owner: who picked it, in their own words in the thread' };
    page.chosen = `${c[1]} ${c[2].padStart(2, '0')}:${c[3]}`; page.chosen_by = opts['chosen-by'];
  }
  // Questions that are not a time or a place (money, intros, favors) stay open until the owner answers.
  if (opts.open) page.open = [...(page.open || []), String(opts.open).slice(0, 200)];
  if (opts.close) page.open = (page.open || []).filter((q, i) => String(i + 1) !== String(opts.close) && !q.toLowerCase().includes(String(opts.close).toLowerCase()));
  if (opts.next !== undefined) page.next_step = opts.next;
  let status = opts.status, why = '';
  if (status !== undefined && !STATUSES.includes(status)) return { ok: false, error: `unknown status "${status}"; one of ${STATUSES.join(', ')}` };
  if (status && NEEDS_DELIVERY.has(status)) {
    if (!page.chat) return { ok: false, error: `"${status}" needs --chat (the thread it went to), so the send can be checked` };
    let arrived = null;
    try { arrived = await checkDelivery(page.chat); } catch { arrived = null; }
    if (arrived !== true) { why = arrived === false ? 'Plow has not delivered it' : 'delivery could not be checked'; status = 'unverified'; }
  }
  if (opts.nudged) page.nudges = Number(page.nudges || 0) + 1;
  if (status && status !== page.status && ['sent', 'waiting_on_them'].includes(status) && page.status !== 'sent' && page.status !== 'waiting_on_them') page.nudges = 0;
  if (status) page.status = status;
  page.updated = new Date(now).toISOString();
  const stamp = new Date(now).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const note = [status ? `status → ${status}${why ? ` (${why})` : ''}` : '', opts.note || ''].filter(Boolean).join('. ');
  if (note) page.log = `${page.log ? page.log.trim() + '\n' : ''}- ${stamp} · ${note}`;
  write(slug, page);
  return { ok: true, slug, status: page.status, recorded: status === opts.status, ...(why ? { note: `Recorded as unverified: ${why}. Tell the owner the text may not have arrived; do not say it was sent.` } : {}) };
}

// ---- CLI -------------------------------------------------------------------------------------
if (process.argv[1]?.endsWith('pipeline.mjs')) {
  const [cmd, slugArg, ...rest] = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) { const k = rest[i].slice(2); const v = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[++i]; opts[k] = v; }
  const out = (o) => { console.log(JSON.stringify(o)); process.exit(o.ok === false ? 1 : 0); };
  if (cmd === 'list') out({ ok: true, ...list() });
  else if (cmd === 'show' && slugArg) { const s = resolve(slugArg); out(read(s) ? { ok: true, slug: s, ...read(s) } : { ok: false, error: `no page for ${slugArg}` }); }
  else if (cmd === 'set' && slugArg) out(await set(resolve(slugArg, opts.handle), { ...(/^[+\d\s()-]+$/.test(slugArg) ? { handle: slugArg } : { contact: slugArg }), ...opts }));
  else out({ ok: false, error: 'usage: pipeline.mjs list | show <contact> | set <contact> --status … [--chat …] [--proposed …] [--next …] [--note …] [--nudged]' });
}
