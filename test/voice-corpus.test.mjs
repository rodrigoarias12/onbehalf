// node test/voice-corpus.test.mjs — the patterns must never flag an assistant line from the
// outside corpora (a false alarm makes the model rewrite a correct text, or drops it at the last
// door). How many OWNER lines they catch is not asserted here: that is the judge's job, measured
// against Plow's inference by test/measure-voice.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ownerVoice } from '../plugin/voice-guard/voice.js';
const corpus = JSON.parse(readFileSync(new URL('./voice-corpus.json', import.meta.url), 'utf8'));
let n = 0;
for (const [name, set] of Object.entries(corpus)) {
  if (name.startsWith('_')) continue;
  for (const line of set.assistant) { const hit = ownerVoice(line); assert.equal(hit, null, `${name}: false alarm on "${line}" (${hit?.rule})`); n++; }
}
console.log(`ok: ${n} assistant lines from outside corpora, no false alarms from the patterns`);
