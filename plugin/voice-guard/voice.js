// The rule, as data: a message that goes to anyone other than the owner is written BY the
// owner's assistant, never AS the owner. "Sam is free Tuesday" is fine; "I'm free Tuesday" is
// the owner talking, and the person reading it cannot tell it was a machine.
//
// Pure functions only: the hooks in index.js decide WHEN to check; this file decides WHAT
// counts. Tested by test/voice.test.mjs.

/** First-person lines about the owner's time, plans or presence. Each pattern names itself. */
export const OWNER_VOICE = [
  ['free/available', /\bI(?:'m|’m| am)\s+(?:free|available|open|around|flexible|good|in town|out of town|busy|booked|swamped|traveling|travelling)\b/i],
  ['I can make it', /\bI\s+can\s+(?:do|make|meet|come|join|grab|swing by|hop on)\b/i],
  ['works for me', /\b(?:works|work|suits)\s+(?:for\s+)?me\b/i],
  ['my calendar', /\bmy\s+(?:calendar|schedule|availability|diary|week|day|afternoon|morning|evening|lunch|weekend)\b/i],
  // "See you then!" opens a sentence as the owner; "Sam will see you there" is the assistant.
  ['see you', /(?:^|[.!?]\s*|\bI(?:'ll|’ll| will)\s+)see\s+(?:you|ya)\s+(?:then|there|soon|tomorrow|on|at|next)\b/i],
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
