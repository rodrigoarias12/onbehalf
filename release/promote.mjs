#!/usr/bin/env node
// The only way an OnBehalf image reaches production (Plow's one-click pin).
//
//   node release/promote.mjs <commit> [--token-file ~/.config/plow/token-…]
//
// It refuses unless, for that exact commit on GitHub:
//   - "test"  passed: every deterministic test, including test/regressions.json (real incidents);
//   - "eval"  passed: the voice guard against Plow's model, above the thresholds in measure-voice.mjs;
//   - "image" passed, and its log names the digest that gets promoted.
// Then it runs plow-agents image promote with that digest. Nothing else promotes; a green local run
// is not enough, because CI is what replays the incidents on a clean checkout.
//
// Lives outside bin/ on purpose: bin/ is copied into the image, and this runs only on the
// maintainer's machine (it reads GitHub and shells out to plow-agents).

import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const argv = process.argv.slice(2);
const commit = argv.find((a) => !a.startsWith('--'));
const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const tokenFile = flag('token-file') || `${homedir()}/.config/plow/token-iphone-79e743f1`;
const plowAgents = flag('plow-agents') || `${homedir()}/Documents/GitHub/plow-agents/bin/plow-agents`;
const repo = flag('repo') || 'rodrigoarias12/onbehalf';
const die = (m) => { console.error(`promote: REFUSED. ${m}`); process.exit(1); };
if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) die('usage: node release/promote.mjs <commit sha>');

const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8' });
const sha = gh('api', `repos/${repo}/commits/${commit}`, '-q', '.sha').trim(); // GitHub matches runs by the full SHA
const runs = JSON.parse(gh('run', 'list', '-R', repo, '--commit', sha, '--limit', '20', '--json', 'workflowName,conclusion,status,databaseId,headSha'));
const latest = (name) => runs.find((r) => r.workflowName === name);
for (const name of ['test', 'eval', 'image']) {
  const r = latest(name);
  if (!r) die(`no "${name}" run for ${commit}.`);
  if (r.status !== 'completed' || r.conclusion !== 'success') die(`"${name}" for ${commit} is ${r.status}/${r.conclusion}: fix it first.`);
}
const log = gh('run', 'view', String(latest('image').databaseId), '-R', repo, '--log');
const digest = (log.match(/"containerimage\.digest":\s*"(sha256:[0-9a-f]{64})"/) || [])[1];
if (!digest) die('could not read the pushed digest from the image run.');
const ref = `ghcr.io/${repo}@${digest}`;
console.log(`promote: test, eval and image passed for ${commit.slice(0, 7)}; promoting ${ref}`);
execFileSync('python3.12', [plowAgents, '--token-file', tokenFile, 'image', 'promote', 'onbehalf', ref], { stdio: 'inherit' });
