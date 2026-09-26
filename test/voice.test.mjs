// node test/voice.test.mjs — the lines from the screenshot that started this project, and the
// lines an assistant must be free to write.
import assert from 'node:assert/strict';
import { ownerVoice, isOwnerSession, rewriteInstruction, wrongWeekday } from '../plugin/voice-guard/voice.js';

const ownerLines = [
  "Hey Patrick! I'm free for lunch any day next week — Tue Sep 29, Wed Sep 30.",
  'Patrick what can I get you',
  'Great, calendar invite sent for Friday 8:45 at Verve Coffee. See you then!',
  'Tuesday works for me.',
  "I'd love to catch up next week.",
  'Let me check my calendar and get back to you.',
  "Let's grab coffee on Thursday.",
  'I can do 3pm.',
  'Estoy libre el martes al mediodía.',
  'Nos vemos el jueves.',
];
const assistantLines = [
  "Hi Patrick, this is Spruce, Sam's assistant. Sam is free for lunch Tue–Fri next week, 12–1pm PT. Which day works best for you?",
  "Great, I've sent the calendar invite for Friday 8:45 at Verve Coffee. Sam will see you there.",
  "I'll send the invite as soon as you pick a day.",
  "Sam asked me to find a time. Does Wednesday at noon suit you?",
  'Hola Patrick, soy Spruce, el asistente de Sam. Sam está libre el martes al mediodía.',
  'He said: "I\'m free on Tuesday" — does that work for you?',
];
for (const l of ownerLines) assert.ok(ownerVoice(l), `should flag: ${l}`);
for (const l of assistantLines) assert.equal(ownerVoice(l), null, `should pass: ${l}`);
assert.ok(isOwnerSession('agent:main:main'));
assert.ok(!isOwnerSession('agent:main:plow:group:cht_abc'));
assert.ok(!isOwnerSession(undefined));
assert.match(rewriteInstruction(ownerVoice(ownerLines[0]), { owner: 'Sam', assistant: 'Spruce' }), /Sam is free Tuesday/);
const today = new Date(Date.UTC(2026, 8, 26));
assert.ok(wrongWeekday('How about Monday, Oct 6, 12-1pm PT?', today), 'Oct 6 2026 is a Tuesday');
assert.equal(wrongWeekday('How about Tuesday, Oct 6, 12-1pm PT?', today), null);
assert.equal(wrongWeekday('Tue Sep 29, Wed Sep 30 or Thu Oct 1', today), null);
assert.ok(wrongWeekday('¿Le sirve el lunes 6 de octubre?', today));
assert.equal(wrongWeekday('¿Le sirve el martes 6 de octubre?', today), null);
assert.ok(wrongWeekday('Que tal segunda-feira, 6 de outubro?', today), '6/10/2026 é terça');
assert.equal(wrongWeekday('Que tal terça-feira, 6 de outubro?', today), null);
console.log(`ok: ${ownerLines.length} owner-voice lines flagged, ${assistantLines.length} assistant lines pass`);
