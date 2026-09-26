// node test/corpus.mjs — measures the voice rules on a corpus, not on a handful of lines.
// OWNER: lines the owner would write to someone; the guard must stop every one.
// ASSISTANT: lines a good assistant writes to someone; the guard must let every one through.
// Prints misses and false alarms, and exits non-zero if either list is not empty.
import { ownerVoice } from '../plugin/voice-guard/voice.js';

export const OWNER = [
  // the screenshot
  "Hey Patrick! I'm free for lunch any day next week — Tue Sep 29, Wed Sep 30, Thu Oct 1, or Fri Oct 2, 12pm PT.",
  'Patrick what can I get you',
  'Great, calendar invite sent for Friday 8:45 at Verve Coffee. See you then!',
  // availability
  "I'm free Tuesday after 3.", 'I am available Thursday morning.', "I'm around all afternoon, swing by.",
  "I'm open Wednesday if that helps.", "I'm flexible next week.", "I'm out of town until the 5th.",
  "I'm booked solid Monday, how about Tuesday?", "Sorry, I'm swamped this week.",
  // accepting
  'Tuesday works for me.', 'That works for me!', '3pm suits me.', 'I can do 3pm.', 'I can make Thursday.',
  'I can meet at the office.', 'I can hop on a call at 4.',
  // calendar ownership
  'Let me check my calendar.', 'My afternoon is wide open.', "Let me look at my schedule and get back to you.",
  // social
  'See you then!', 'See you Thursday.', "I'll see you there.", "I'll be there at noon.", "Let's grab coffee Thursday.",
  "Let's meet at Verve.", "Let's find a time next week.", "I'd love to catch up.", "I'd love to meet your cofounder.",
  'Meet me at the lobby.', "Looking forward to seeing you!",
  // Spanish
  'Estoy libre el martes al mediodía.', 'Ando ocupado esta semana.', 'El jueves me queda bien.', 'Nos vemos el jueves.',
  'Dejame ver mi agenda.',
  // Portuguese
  'Estou livre na terça ao meio-dia.', 'Tô ocupado essa semana.', 'Quinta pra mim funciona.', 'Posso às 3 da tarde.',
  'Te vejo na quinta!', 'Deixa eu ver minha agenda.', 'Vamos marcar um café na sexta?', 'Nos vemos amanhã.',
];

export const ASSISTANT = [
  "Hi Patrick, this is Spruce, Sam's assistant. Sam is free for lunch Tue–Fri next week, 12–1pm PT. Which day works best for you?",
  "Great, I've sent the calendar invite for Friday 8:45 at Verve Coffee. Sam will see you there.",
  "I'll send the invite as soon as you pick a day.", 'Sam asked me to find a time. Does Wednesday at noon suit you?',
  "I can do that for you.", "I can send you a Zoom link instead, if that's easier.", "I can hold Thursday while you check.",
  "I'm happy to help find another time.", "I'm Sam's assistant, an AI. Sam reads this thread too.",
  "I'm available here if you have any questions about the meeting.", "I'm checking with Sam and will get back to you today.",
  "Sam's calendar is open Thursday afternoon.", "Sam can do 3pm.", 'Sam would love to meet your cofounder.',
  "That works — I've booked Thursday 12–1pm PT at Verve and sent the invite to psalyer@mayfield.com.",
  "Sam says: see you Thursday!", 'He said: "I\'m free on Tuesday" — does that work for you?',
  "Let me check with Sam and come back to you.", "Let me know which works best for you.", 'Looking forward to confirming a time.',
  "Hola Patrick, soy Spruce, el asistente de Sam. Sam está libre el martes al mediodía.",
  'Sam te espera el jueves en Verve.', 'Le confirmo a Sam y te aviso.',
  // Portuguese
  'Oi Patrick, aqui é a Spruce, assistente do Sam (sou uma IA). O Sam está livre na terça ao meio-dia.',
  'Posso te mandar o convite por aqui mesmo.', 'Vou confirmar com o Sam e te aviso hoje.', 'O Sam te encontra na quinta no Verve.',
  'Qual horário funciona melhor pra você?',
];

const misses = OWNER.filter((l) => !ownerVoice(l));
const falseAlarms = ASSISTANT.map((l) => [l, ownerVoice(l)]).filter(([, h]) => h);
console.log(`owner lines stopped: ${OWNER.length - misses.length}/${OWNER.length}`);
console.log(`assistant lines passed: ${ASSISTANT.length - falseAlarms.length}/${ASSISTANT.length}`);
for (const l of misses) console.log(`  MISS  ${l}`);
for (const [l, h] of falseAlarms) console.log(`  FALSE ${l}  ← "${h.phrase}" (${h.rule})`);
if (process.argv[1]?.endsWith('corpus.mjs')) process.exit(misses.length || falseAlarms.length ? 1 : 0);
