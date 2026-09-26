---
name: schedule
description: Set up a meeting on the owner's behalf by text. Find real slots, text the other person as the owner's assistant (never as the owner), agree a time, book it, release the rest, report in one line.
---

# schedule

`onbehalf.json` in the workspace has the owner's name, your name, the time zone, whether the
first message to a new person is shown to the owner first, and the owner's usual windows.
Read it first. If it is missing, run the first conversation in `AGENTS.md` before anything.

## 1. Understand the ask

From the owner's private chat: who (name and phone number, E.164), what (lunch, coffee, call,
a 30-min intro), how long, where (a place, a video link, "their office"), and by when. One
question for whatever is missing, all of it in one message. A phone number you were not
given is asked for, never guessed.

## 2. Find real slots

- With the owner's Mac connected: read the calendar for the window (`google-workspace` via
  `owners-mac`), and pick two to four free slots that fit the kind of meeting (lunch is
  12–1:30, coffee is mornings, calls are anywhere in the windows). Hold them as tentative
  events titled `Hold: <what> with <who>` if the calendar tools allow it.
- Without it: pick from `windows` and tell the owner these are unconfirmed.

Write times in the other person's time zone when you know it, and always with the zone.

## 3. Text the other person, as the assistant

`plow_start_thread` with their number and the first message. The owner is added to the thread
automatically. The first message:

> Hi Patrick, this is Spruce, Sam's assistant. Sam would love to grab lunch next week. Sam is
> free Tue Sep 29, Wed Sep 30, Thu Oct 1 or Fri Oct 2, 12–1pm PT. Which works best for you?

If `firstMessage` is `show` and this person is new, send that draft to the owner's private
chat first and wait for "ok" (or an edit).

## 4. The back and forth

Replies in that thread run in that room. Keep answering there, as the assistant: confirm the
slot they pick, offer the next ones if none fit, ask the owner privately for anything that is
not a time or a place. Your owner may write in the same thread; that is them, not you, and
you never answer in their name.

## 5. Book it and report

- Book the chosen slot on the owner's calendar with the other person's email if you have it
  (ask for it in the thread: "What email should I send the invite to?"), the place or the
  link, and a title both would recognize.
- Delete the other holds.
- In the thread: "Booked: Thursday Oct 1, 12–1pm PT at Verve, Palo Alto. Invite sent to
  psalyer@mayfield.com." Only after the tool confirmed it.
- In the owner's private chat, one line: "Lunch with Patrick: Thu Oct 1, 12–1pm, Verve.
  Invite sent."
