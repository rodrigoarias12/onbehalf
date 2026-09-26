# OnBehalf

**A scheduling assistant you text. It speaks for you, never as you.**

You tell it "set up lunch with Patrick next week". It finds real slots on your calendar,
texts Patrick, agrees a time and books it. To Patrick it writes the way a good human assistant
would: *"Hi Patrick, this is Spruce, Sam's assistant. Sam is free Tue–Fri at noon. Which works
best?"*, never *"I'm free for lunch!"*.

That last part is the whole project. Assistants built on a model write in their owner's voice
sooner or later, and a prompt rule does not stop it: it holds most of the time, and a text to
an investor cannot be "most of the time". So OnBehalf enforces it in the Gateway, outside the
model.

## The voice guard

[`plugin/voice-guard`](plugin/voice-guard) is an OpenClaw plugin with three checks. None of
them depends on the model obeying:

| When | What it does |
|---|---|
| The model is about to finish a reply in a room with someone other than the owner | If the reply sounds like the owner ("I'm free", "See you then!", "works for me", "my calendar"), OpenClaw sends it back for one more pass with the exact phrase and how to fix it. |
| The model calls `message` or `plow_start_thread` | An owner-voice text to someone else is blocked, and the model gets the reason. |
| Any message is about to leave for a room with someone else in it | The last door: if it still carries the owner's voice, it is not delivered. If the guard cannot tell whose room it is, it assumes someone else's. |

The owner's private chat is untouched: there the assistant talks to its owner normally.

Verified on OpenClaw 2026.9.6: told to send *"Hey Patrick! I am free for lunch any day next
week… See you then!"* word for word in a group thread, the agent delivered *"Hi Patrick, this
is Spruce, Sam's assistant. Sam is free for lunch any day next week…"*. The same line in the
owner's private chat went through unchanged. The rules are in
[`voice.js`](plugin/voice-guard/voice.js) and tested against real lines in
[`test/voice.test.mjs`](test/voice.test.mjs).

## Install

**One text, nothing to install:** send `Set this up for me: aiworthusing.com/agent-index/onbehalf`
by iMessage to +1 (628) 246-3032. Your assistant texts you back from its own number; text it
from the same iPhone. It asks your name, the name it signs with, your time zone and your usual
windows, and whether to show you the first message to someone new.

**Your own OpenClaw Gateway:** copy `plugin/voice-guard` into your OpenClaw's
`dist/extensions/` (or install it with `openclaw plugins install --link ./plugin/voice-guard`
and set `plugins.entries.voice-guard.hooks.allowConversationAccess: true`), put `AGENTS.md`
and `skills/` in the agent's workspace, and restart the Gateway.

## Works with DailyRecap

[DailyRecap](https://github.com/rodrigoarias12/dailyrecap), the startup's chief of staff, asks
every agent on the team what happened each evening. OnBehalf answers with the meetings it
booked, the ones pending, and anything the guard made it rewrite, each with its thread.

## License

MIT.
