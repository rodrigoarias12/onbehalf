// The rule, as data: a message that goes to anyone other than the owner is written BY the
// owner's assistant, never AS the owner. "Sam is free Tuesday" is fine; "I'm free Tuesday" is
// the owner talking, and the person reading it cannot tell it was a machine.
//
// Pure functions only: the hooks in index.js decide WHEN to check; this file decides WHAT
// counts. Tested by test/voice.test.mjs.

/** First-person lines about the owner's time, plans or presence. Each pattern names itself. */
export const OWNER_VOICE = [
  // "I'm available here if you have questions" is the assistant offering help, not the owner's calendar.
  ['free/available', /\bI(?:'m|’m| am)\s+(?:free|available|open|around|flexible|good|in town|out of town|busy|booked|swamped|traveling|travelling)\b(?!\s+(?:here|if\b|to help|to answer|for (?:any )?questions))/i],
  // "I can do that for you" is the assistant taking a task; "I can do 3pm" is the owner's time.
  ['I can make it', /\bI\s+can\s+(?:do|make|meet|come|join|grab|swing by|hop on)\b(?!\s+(?:that|this|it|so|those|these)\b)/i],
  ['works for me', /\b(?:works|work|suits)\s+(?:for\s+)?me\b/i],
  ['my calendar', /\bmy\s+(?:calendar|schedule|availability|diary|week|day|afternoon|morning|evening|lunch|weekend)\b/i],
  // "See you then!" opens a sentence as the owner; "Sam will see you there" is the assistant.
  ['see you', /(?:^|[.!?]\s*|\bI(?:'ll|’ll| will)\s+)see\s+(?:you|ya)\s+(?:then|there|soon|later|tomorrow|tonight|on|at|next|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i],
  ['looking forward', /(?:^|[.!?]\s*|\bI(?:'m|’m| am)\s+)(?:really\s+)?looking\s+forward\s+to\s+(?:seeing|meeting|catching up|chatting|it)\b/i],
  ['let\'s meet', /\blet(?:'|’)?s\s+(?:meet|grab|do|catch up|get (?:lunch|coffee|dinner|together)|find a time|hop on)\b/i],
  ['I\'ll be there', /\bI(?:'ll|’ll| will)\s+(?:be there|see you|meet you|come|swing by|join you)\b/i],
  ['I\'d love to', /\bI(?:'d|’d| would)\s+(?:love|like)\s+to\s+(?:meet|grab|catch|see|join|chat|connect|get)\b/i],
  ['meet me', /\bmeet\s+me\b/i],
  ['what can I get you', /\bwhat\s+can\s+I\s+get\s+you\b/i],
  // Spanish, for owners who text in it.
  ['estoy libre', /\b(?:estoy|ando)\s+(?:libre|disponible|ocupad[oa])\b/i],
  ['me queda bien', /\bme\s+(?:queda|viene)\s+(?:bien|mejor)\b/i],
  ['nos vemos', /\bnos\s+vemos\s+(?:el|a las|ma[ñn]ana|entonces|ah[ií])\b/i],
  ['mi agenda', /\bmi\s+(?:agenda|calendario|disponibilidad)\b/i],
  // Portuguese (Brazil), for owners and guests who text in it.
  ['estou livre', /\b(?:estou|t[ôo]|fico|estarei)\s+(?:livre|dispon[íi]vel|ocupad[oa]|tranquil[oa])\b/i],
  ['pra mim funciona', /\b(?:pra|para)\s+mim\s+(?:funciona|d[áa]|serve|fica bom|t[áa] bom)\b/i],
  ['posso às 3', /\b(?:eu\s+)?posso\s+(?:[àa]s?\s+\d|na\s+(?:segunda|ter[çc]a|quarta|quinta|sexta)|amanh[ãa]|hoje)/i],
  ['te vejo', /(?:^|[.!?]\s*)(?:te\s+vejo|nos\s+vemos|a\s+gente\s+se\s+v[êe])\b/i],
  ['minha agenda', /\bminha\s+(?:agenda|disponibilidade|semana|tarde|manh[ãa])\b/i],
  ['vamos marcar', /(?:^|[.!?]\s*)vamos\s+(?:marcar|tomar|almo[çc]ar|nos\s+encontrar)\b/i],
];

/** Returns the first owner-voice phrase found, or null. Quoted text ("…") is not the assistant's voice and is skipped. */
export function ownerVoice(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const unquoted = text.replace(/"[^"]*"|“[^”]*”/g, ' ');
  for (const [name, re] of OWNER_VOICE) {
    const m = unquoted.match(re);
    if (m) return { rule: name, phrase: m[0] };
  }
  return null;
}

/** The instruction the model gets when it slipped. Specific, with the phrase it used. */
export function rewriteInstruction(hit, who) {
  const owner = who?.owner || 'the owner';
  const assistant = who?.assistant || 'the assistant';
  return [
    `This message goes to someone other than ${owner}, and it is written as if you were ${owner}: "${hit.phrase}".`,
    `Rewrite it as ${owner}'s assistant. ${owner} in the third person ("${owner} is free Tuesday", "${owner} can do 12"),`,
    `first person only for what you yourself do ("I'll send the invite"). If this is the first message in the thread,`,
    `introduce yourself once: "Hi, this is ${assistant}, ${owner}'s assistant." Never write a line ${owner} would write.`,
  ].join(' ');
}

/** Session keys: the owner's private chat is the agent's main session; every other session is someone else's room. */
export function isOwnerSession(sessionKey) {
  if (typeof sessionKey !== 'string' || !sessionKey) return false;
  return /^agent:[^:]+:main$/.test(sessionKey);
}

// ---- Dates: a weekday that does not match its date ------------------------------------------
// "Monday, Oct 6" when Oct 6 is a Tuesday is worse than no date: the other person books the
// wrong day. Checked against the nearest occurrence of that date from today (this year, or next
// year if it already passed more than a month ago).
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  ene: 0, abr: 3, ago: 7, dic: 11, set: 8 };
const DAY_ES = { lun: 1, mar: 2, 'mié': 3, mie: 3, jue: 4, vie: 5, 'sáb': 6, sab: 6, dom: 0 };
const DAY_PT = { seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, 'sáb': 6, sab: 6, dom: 0 };
const MONTHS_PT = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
const PT = /\b(seg|ter|qua|qui|sex|s[áa]b|dom)[a-zçá]*(?:-feira)?\.?,?\s+(?:dia\s+)?(\d{1,2})\s+de\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*/gi;
const EN = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/gi;
const ES = /\b(lun|mar|mi[ée]|jue|vie|s[áa]b|dom)[a-zéá]*\.?,?\s+(\d{1,2})\s+de\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*/gi;

export function wrongWeekday(text, today = new Date()) {
  if (typeof text !== 'string') return null;
  const resolve = (month, day) => {
    let y = today.getFullYear();
    const d = new Date(Date.UTC(y, month, day));
    if (d.getTime() < today.getTime() - 31 * 864e5) return new Date(Date.UTC(y + 1, month, day));
    return d;
  };
  for (const m of text.matchAll(EN)) {
    const said = DAYS.indexOf(m[1].toLowerCase()), date = resolve(MONTHS[m[2].toLowerCase()], Number(m[3]));
    if (said !== date.getUTCDay()) return { phrase: m[0], actual: date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) };
  }
  for (const m of text.matchAll(ES)) {
    const said = DAY_ES[m[1].toLowerCase()], date = resolve(MONTHS[m[3].toLowerCase()], Number(m[2]));
    if (said !== undefined && said !== date.getUTCDay()) return { phrase: m[0], actual: date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  }
  for (const m of text.matchAll(PT)) {
    const said = DAY_PT[m[1].toLowerCase()], date = resolve(MONTHS_PT[m[3].toLowerCase()], Number(m[2]));
    if (said !== undefined && said !== date.getUTCDay()) return { phrase: m[0], actual: date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  }
  return null;
}

export function dateInstruction(hit) {
  return `A date in this message has the wrong weekday: "${hit.phrase}" is actually ${hit.actual}. Recompute every weekday and date in the message from the calendar before sending; if in doubt, give the date without the weekday.`;
}
