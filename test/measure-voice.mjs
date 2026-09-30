// node test/measure-voice.mjs — the guard as it runs on Plow (patterns, then the model) against the
// outside corpora in voice-corpus.json. Needs PLOW_AGENT_TOKEN (source ./plow-credentials) and
// PLOW_API_BASE; not part of CI, it calls Plow's inference (about 250 calls, well under US$0.25).
import { readFileSync } from 'node:fs';
import { ownerVoice } from '../plugin/voice-guard/voice.js';
import { judgeVoice } from '../plugin/voice-guard/judge.js';
const corpus = JSON.parse(readFileSync(new URL('./voice-corpus.json', import.meta.url), 'utf8'));
const who = { owner: 'Sam', assistant: 'Spruce' };
const pool = async (xs, n, f) => { const out = []; let i = 0; await Promise.all([...Array(n)].map(async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k]); } })); return out; };
const verdict = async (l) => ownerVoice(l) ? { by: 'patterns', owner: true } : ((j) => j ? { by: 'judge', owner: j.owner } : { by: 'none', owner: false })(await judgeVoice(l, who));
for (const [name, set] of Object.entries(corpus)) {
  if (name.startsWith('_')) continue;
  const o = await pool(set.owner, 4, verdict), a = await pool(set.assistant, 4, verdict);
  console.log(`${name}: owner voice stopped ${o.filter((v) => v.owner).length}/${o.length} (patterns alone ${o.filter((v) => v.by === 'patterns').length}) · assistant lines passed ${a.filter((v) => !v.owner).length}/${a.length} · judge unavailable ${[...o, ...a].filter((v) => v.by === 'none').length}`);
  set.owner.forEach((l, k) => !o[k].owner && console.log(`  missed: ${l}`));
  set.assistant.forEach((l, k) => a[k].owner && console.log(`  false alarm: ${l}`));
}
