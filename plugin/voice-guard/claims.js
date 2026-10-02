// "Sent", "booked", "on both calendars": a claim the reader will act on. In a red-team run the
// assistant told a guest "Mandei o convite pro seu email com o link do Zoom" (the file had no email
// and no Zoom), and told its owner a weekly 1:1 was booked when it was one event and the guest had
// never answered. Each part worked; the sentence was false. So a claim goes out only with its proof
// in the same conversation: an invite the script made, or a calendar write that returned.
//
// Pure functions: index.js keeps the evidence per session and decides when to ask.

const S = String.raw`(?:^|[.!?\n]\s*|\b(?:great|perfect|done|ok|okay|listo|perfecto|pronto|feito|beleza)[!,.]*\s+)`;

/** [kind, pattern]: kind says what would prove it. Past tense only: "I'll send the invite" is a promise, not a claim. */
export const CLAIMS = [
  ['invite', /\b(?:invite|invitation)\s+(?:is\s+|was\s+|has\s+been\s+|'s\s+|’s\s+)?(?:sent|on its way|out|in your inbox)\b/i],
  ['invite', /\bI(?:'ve|’ve| have)?\s+sent\s+(?:you\s+|him\s+|her\s+|them\s+)?(?:the\s+|an\s+|a\s+)?(?:calendar\s+)?(?:invite|invitation)\b/i],
  ['invite', /\b(?:te\s+|le\s+|les\s+)?(?:mand[ée]|envi[ée])\s+(?:la\s+|el\s+|una\s+|un\s+)?(?:invitaci[oó]n|invite|convite)\b|\binvitaci[oó]n\s+(?:enviada|mandada)\b/i],
  ['invite', /\b(?:te\s+)?(?:mandei|enviei)\s+(?:o\s+|um\s+)?convite\b|\bconvite\s+(?:enviado|mandado)\b/i],
  ['booking', new RegExp(S + String.raw`(?:booked|confirmed|all set|scheduled)\s*[:!—–-]`, 'i')],
  ['booking', /\bI(?:'ve|’ve| have)\s+(?:booked|scheduled|set up)\s+(?:it|the|a|your|this|that|lunch|coffee|the call|the meeting)\b/i],
  ['booking', /\b(?:it's|it’s|you're|you’re|he's|he’s|she's|she’s)\s+(?:all\s+)?(?:booked|set)\s+for\b/i],
  ['booking', /\b(?:qued[oó]|est[aá])\s+(?:agendad[oa]|confirmad[oa]|reservad[oa])\b|\bagend[ée]\b/i],
  ['booking', /\b(?:ficou|est[aá])\s+(?:agendad[oa]|marcad[oa]|confirmad[oa])\b|\bagendei\b|\bmarquei\b/i],
  ['calendar', /\b(?:put|added|it's|it’s|is)\s+(?:it\s+)?(?:on|to|in)\s+(?:both|your|his|her|their|our)\s+calendars?\b/i],
  // Promised, even in the future tense, through a channel this agent does not have without the owner's
  // Mac: an invite by email or with a Zoom link. ("O convite com o link do Zoom vai chegar no
  // marina@… em breve": nothing was made, and nothing here can email or create Zoom links.)
  ['channel', /\b(?:invite|invitation|convite|invitaci[oó]n)\b[^!?\n]{0,160}?(?:\b(?:e-?mail|inbox|zoom|caixa de entrada|correo)\b|[\w.+-]+@[\w-]+\.[\w.]+)|\b(?:zoom|e-?mail)\b[^.!?\n]{0,40}\b(?:invite|invitation|convite|invitaci[oó]n)\b/i],
  ['recurring', /\b(?:recurring|weekly|every\s+(?:week|monday|tuesday|wednesday|thursday|friday)|semanal|cada\s+semana|toda\s+semana|semanalmente)\b[^.!?\n]{0,60}\b(?:booked|sent|set up|invite|agendad|enviad|marcad|convite|invitaci)/i],
];

const NEGATION = /\b(?:can['’]?t|cannot|can not|won['’]?t|unable|not able|no puedo|no se puede|no pude|n[ãa]o\s+(?:consigo|posso|d[áa]|consegui))\b/i;

const CONDITIONAL = /\b(?:until|once|when|after|as soon as|cuando|hasta que|apenas|quando|at[ée] que|assim que|depois que)\b/i;

/** The first claim in the text that the evidence does not back, or null. */
export function unprovenClaim(text, ev = {}) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const media = /^\s*MEDIA:\S+\.ics\s*$/m.test(text); // the invite file goes out with this very message
  for (const [kind, re] of CLAIMS) {
    const m = text.match(re);
    if (!m) continue;
    // "I can't create recurring events, invite.mjs only makes one" is the honest answer, not a claim.
    const at = m.index ?? text.indexOf(m[0]);
    const start = Math.max(text.lastIndexOf('.', at), text.lastIndexOf('!', at), text.lastIndexOf('?', at), text.lastIndexOf('\n', at)) + 1;
    const endAt = text.slice(at).search(/[.!?\n]/);
    const sentence = text.slice(start, at + m[0].length), closing = endAt < 0 ? '' : text[at + endAt];
    if (NEGATION.test(sentence)) continue;
    if (closing === '?') continue; // "What's the best email for the invite?" asks, it claims nothing
    if (CONDITIONAL.test(text.slice(start, at))) continue; // "until the invite is out", "once Ian picks
    const proven = kind === 'recurring' || kind === 'channel' ? Boolean(ev.calendar)
      : kind === 'calendar' ? Boolean(ev.calendar)
      : Boolean(ev.invite || ev.calendar || media || (kind === 'booking' && ev.confirmed));
    if (!proven) return { kind, phrase: m[0].trim() };
  }
  return null;
}

export function claimInstruction(hit) {
  const what = {
    invite: 'no invite was made in this conversation (invite.mjs) and no calendar event was created',
    booking: 'nothing is booked yet: no invite was made and no calendar event was created, and the other person may not have picked a time',
    calendar: 'no calendar event was created on anyone\'s calendar (an .ics file is something people add themselves)',
    recurring: 'invite.mjs makes ONE single event; nothing recurring exists',
    channel: "without the owner's Mac you cannot email an invite or create a Zoom link: the invite is a file posted in this thread (invite.mjs), and only after the slot is recorded as chosen",
    owner_task: "that hands the owner a task nobody asked him for. You send the invite (invite.mjs, once the slot is recorded as chosen); if you cannot do what was asked (a Zoom link, an email), say so to the owner privately and tell the guest you will confirm",
  }[hit.kind];
  return `You wrote "${hit.phrase}", but ${what}. Say only what is true right now (what is pending, and on whom: "Once Ian picks a time, I'll send the invite"), or do it first and then say it.`;
}

// ---- what a guest writes that the system must not leave to the model --------------------------
// "Stop texting me" is recorded by code; a money question stays open until the owner answers.
export const STOP = /\b(?:stop\s+(?:texting|messaging|contacting)|don'?t\s+(?:text|message|contact)\s+me|unsubscribe|leave me alone|no\s+me\s+(?:escribas|escriban|mandes|contactes)|dej[aá]\s+de\s+escribir|n[ãa]o\s+me\s+(?:mande|escreva|mandem|escrevam)|pare\s+de\s+(?:me\s+)?(?:mandar|escrever))\b/i;
export const MONEY = /(?:\$\s?\d|\b\d+\s?k\b|\b(?:safe|valuation|cap table|term sheet|invest(?:ment|ing)?|pricing|price|discount|fee|equity|precio|descuento|inversi[oó]n|valuaci[oó]n|pre[çc]o|desconto|investimento)\b)/i;

// A preference offered as "the default if you don't care" is a choice made for the owner. Sam's own
// assistant wrote exactly that about Google Meet (his error #7); the red-team run did it with
// lengths ("30 minutes unless you want something else"). Ask plainly, save the answer once.
export const DEFAULTS = /\b(?:is\s+the\s+default|(?:the\s+)?default\s+is\b|if\s+you\s+don['’]?t\s+care|unless\s+you\s+(?:say|want|tell me|prefer)\b|I['’]ll\s+assume\b|por\s+defecto|si\s+no\s+te\s+importa|a\s+menos\s+que\s+(?:digas|quieras)|por\s+padr[ãa]o|se\s+voc[êe]\s+n[ãa]o\s+se\s+importar)/i;
export const defaultInstruction = (phrase) => `You wrote "${phrase}": that picks a preference for the owner. Ask the question plainly with no default offered ("Video or phone? Meet or Zoom?"), save the answer once, and never ask it again.`;

// "Sam vai enviar o convite": the owner signed up for a task nobody asked him for. The assistant
// sends invites; if it cannot, it says so to the owner privately.
export function ownerTask(text, owner) {
  if (!owner || typeof text !== 'string') return null;
  const name = owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(String.raw`\b(?:(?:o\s+|el\s+)?${name}|he|she|ele|ela|[ée]l|ella)\s+(?:will|'ll|’ll|is going to|vai|va a|irá|ir[áa])\s+(?:send|enviar|mandar|share|compartir|compartilhar)\b[^.!?\n]{0,50}\b(?:invite|invitation|convite|invitaci[oó]n|link)`, 'i'));
  return m ? { kind: 'owner_task', phrase: m[0].trim() } : null;
}

// What goes out instead of an unproven claim at the last door: true, short, in their language.
export function holdingReply(text, owner = 'the owner') {
  if (/\b(?:voc[êe]|obrigad|convite|segunda|ter[çc]a|quarta|quinta|sexta|n[ãa]o|est[áa]|beleza|perfeito)\b/i.test(text)) return `Perfeito! Vou confirmar com ${owner === 'the owner' ? 'o dono da agenda' : `o ${owner}`} e te aviso em seguida.`;
  if (/\b(?:usted|vos|invitaci[oó]n|lunes|martes|mi[ée]rcoles|jueves|viernes|gracias|perfecto|qued[oa])\b/i.test(text)) return `¡Perfecto! Lo confirmo con ${owner === 'the owner' ? 'la persona' : owner} y te aviso enseguida.`;
  return `Got it! I'll confirm with ${owner} and get back to you shortly.`;
}
