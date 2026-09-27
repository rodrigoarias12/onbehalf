#!/usr/bin/env node
// Did the texts to other people arrive? Reads the status of the line's own messages from Plow.
// The line is iMessage only: a number without iMessage never gets the text, and Plow keeps it
// at "sent" without an error. Run it right after starting a thread, with --wait, so the owner
// hears "it arrived" or "it did not" instead of "sent".
//
//   node delivery.mjs [--wait 45] [--since 360]
//
// Prints ONE JSON line: { checked, people: [{ to, sent_minutes_ago, status, arrived, replied,
// not_arriving, … }], not_arriving, note }.

import { deliveryReport } from '../plugin/voice-guard/delivery.js';

const argv = process.argv.slice(2);
const one = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const wait = one('wait', 0), since = one('since', 360);

const deadline = Date.now() + wait * 1000;
let r;
try {
  for (;;) {
    r = await deliveryReport({ sinceMin: since });
    const pending = r.people.some((p) => !p.arrived);
    if (!pending || Date.now() >= deadline) break;
    await new Promise((res) => setTimeout(res, 5000));
  }
} catch (e) {
  console.log(JSON.stringify({ checked: false, error: e.message, note: 'Could not read delivery status. Tell the owner the text was sent, not that it arrived.' }));
  process.exit(1);
}
r.note = r.not_arriving
  ? 'A text that did not arrive: tell the owner it did not reach that person (most likely no iMessage on that number) and ask for another iMessage address for them: another number, or their Apple ID email. The line is iMessage only; never offer SMS or WhatsApp.'
  : r.people.some((p) => !p.arrived)
    ? 'Some texts are sent but not delivered yet. Say "sent", not "arrived", and check again later.'
    : 'Every text listed arrived.';
console.log(JSON.stringify(r));
