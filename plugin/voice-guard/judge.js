// The second opinion. The patterns in voice.js catch the owner's voice when it says "I"; texting
// drops the subject ("Free Tuesday", "Tô dentro", "Contá conmigo") and no list of patterns keeps up
// with that. So a message that goes to someone other than the owner, and that the patterns let
// through, is read by a model with one question: who is speaking here, the owner or the assistant?
//
// It runs on the inference Plow gives the agent (same endpoint and token as the agent itself).
// If it cannot answer, it says so (null) and the patterns stand alone: a guard that blocked every
// text whenever the endpoint hiccuped would be switched off by the first owner it annoyed.

const MODEL = process.env.ONBEHALF_JUDGE_MODEL || 'z-ai/glm-5.2';

function prompt(text, who) {
  const owner = who?.owner || 'the owner', me = who?.assistant || 'the assistant';
  return [
    `A scheduling assistant named ${me} texts people on behalf of its owner, ${owner}. It must never sound like ${owner} is the one writing.`,
    ``,
    `The test: reading this message, would the recipient believe the WRITER is the person who will attend the meeting, i.e. that ${owner} wrote it about ${owner}'s own time, whereabouts, acceptance or plans?`,
    `- OWNER VOICE (true): the writer states their own availability, presence, acceptance or plans without it being the assistant's work. "Free Tuesday", "Count me in", "On my way", "See you there!", "Can do 3", "Tô dentro", "Contá conmigo", "I'm free at 3", "Running late", "Let's grab coffee".`,
    `- ASSISTANT VOICE (false): the first person is the assistant doing its job: checking, confirming, holding or finding times, sending invites, rescheduling on request, relaying ${owner}'s words, or being available to help ("I'm around if anything changes", "Happy to find another time that works for both of you", "I'd like to confirm Tuesday with you", "Ana asked me to reschedule"). Any line that names the owner in the third person, relays what the owner said ("${owner} says: see you Thursday"), or only asks which option works is assistant voice.`,
    `When unsure, answer false.`,
    ``,
    `Message:`,
    `<<<${text}>>>`,
    ``,
    `Answer with JSON only: {"owner_voice": true|false, "phrase": "<the exact words that are the owner's voice, or empty>"}`,
  ].join('\n');
}

/** { owner: boolean, phrase } from the model, or null when it could not answer. */
// OpenClaw cuts a hook at 15 s; the judge gives up at 12 so the patterns' verdict still stands.
export async function judgeVoice(text, who, { timeoutMs = 12000, fetchImpl = fetch } = {}) {
  if (typeof text !== 'string' || !text.trim()) return { owner: false, phrase: '' };
  const base = (process.env.PLOW_API_BASE || 'https://api.plow.co').replace(/\/$/, '');
  try {
    const r = await fetchImpl(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${process.env.PLOW_AGENT_TOKEN || 'proxied'}` },
      // GLM reasons before it answers and cannot be told not to: a small max_tokens is spent thinking
      // and the answer comes back empty. Low effort and room to finish.
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, ...(MODEL.startsWith('z-ai/') ? { temperature: 0, reasoning: { effort: 'low' } } : {}), messages: [{ role: 'user', content: prompt(text, who) }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const body = await r.json();
    const out = String(body?.choices?.[0]?.message?.content ?? '');
    const json = out.match(/\{[\s\S]*\}/);
    if (!json) return null;
    const v = JSON.parse(json[0]);
    if (typeof v.owner_voice !== 'boolean') return null;
    return { owner: v.owner_voice, phrase: String(v.phrase || '').slice(0, 120) };
  } catch {
    return null;
  }
}
