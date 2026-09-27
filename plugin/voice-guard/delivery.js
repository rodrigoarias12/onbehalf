// Did it arrive? The line is iMessage only. Plow accepts a message ("sent") and Apple delivers
// it ("delivered"); to a number with no iMessage, Apple never does, and nothing says so: the
// message sits at "sent" forever. The model cannot see that, so it reported "sent" as arrived,
// and when asked why nothing arrived it made up that the line sends SMS. This module reads the
// real status from the Plow API and hands it over resolved, so the model copies instead of
// guessing. Used by the voice guard's facts block and by bin/delivery.mjs.

const ARRIVED = new Set(['delivered', 'read']);
const STUCK_AFTER_MIN = 2; // iMessage delivers in seconds; two minutes at "sent" means it won't

function api() {
  const base = (process.env.PLOW_API_BASE || 'https://api.plow.co').replace(/\/$/, '');
  const auth = { Authorization: `Bearer ${process.env.PLOW_AGENT_TOKEN || 'proxied'}` };
  return async (path) => {
    const r = await fetch(`${base}${path}`, { headers: auth, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${path.split('?')[0]}`);
    return r.json();
  };
}

// Outbound texts to people other than the owner, newest per person, within `sinceMin` minutes.
// Each row answers the only question that matters in words and in a boolean: did it arrive.
export async function deliveryReport({ sinceMin = 360, now = Date.now() } = {}) {
  const get = api();
  const chats = (await get('/v1/chats?limit=50')).data || [];
  const people = [];
  for (const chat of chats) {
    const others = (chat.participants || []).filter((p) =>
      !(p.type === 'agent' && p.relationship === 'self') && !(p.type === 'member' && p.role === 'owner'));
    if (!others.length) continue; // the owner's private chat
    const msgs = (await get(`/v1/chats/${encodeURIComponent(chat.uid)}/messages?limit=20`)).data || [];
    // Plow adds a contact card to a new thread; only the text is the assistant's message.
    const last = msgs.find((m) => m.direction === 'outbound' && (m.body || '').trim());
    if (!last) continue;
    const minutesAgo = Math.round((now - Date.parse(last.created_at)) / 60000);
    if (minutesAgo > sinceMin) continue;
    const arrived = ARRIVED.has(last.status);
    const replied = msgs.some((m) => m.direction === 'inbound' && Date.parse(m.created_at) > Date.parse(last.created_at));
    const who = others.map((p) => p.display_name && p.display_name !== p.provider_key ? `${p.display_name} (${p.provider_key})` : p.provider_key).join(', ');
    people.push({
      to: who, chat: chat.uid, sent_minutes_ago: minutesAgo, status: last.status,
      arrived, replied,
      not_arriving: !arrived && minutesAgo >= STUCK_AFTER_MIN,
      text_start: last.body.slice(0, 60),
    });
  }
  return { checked: true, people, not_arriving: people.filter((p) => p.not_arriving).length };
}

// The facts line for the owner's turn. Never throws: a status we could not read says so.
export async function deliveryFacts(opts) {
  let r;
  try { r = await deliveryReport(opts); } catch (e) {
    return `Delivery status: could not be checked (${e.message}). Say "sent", never "it arrived".`;
  }
  if (!r.people.length) return null;
  const lines = r.people.map((p) => {
    if (p.arrived) return `- ${p.to}: arrived (${p.sent_minutes_ago} min ago)${p.replied ? ', and they replied' : ''}.`;
    if (p.not_arriving) return `- ${p.to}: NOT ARRIVED. Sent ${p.sent_minutes_ago} min ago and Apple never delivered it: that number most likely has no iMessage.`;
    return `- ${p.to}: sent ${p.sent_minutes_ago} min ago, not delivered yet.`;
  });
  const rule = r.not_arriving
    ? `Your line is iMessage only: no SMS, no WhatsApp, no email. For a message that did not arrive, tell your owner plainly that it did not reach them, and ask for another iMessage address for that person (another number, or the email of their Apple ID). Never say it was sent successfully.`
    : null;
  return [`Your messages to other people (from the line itself, not from memory):`, ...lines, rule].filter(Boolean).join('\n');
}
