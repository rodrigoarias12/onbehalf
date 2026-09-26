---
name: schedule
description: Set up a meeting on the owner's behalf by text. Find real slots, text the other person as the owner's assistant (never as the owner), agree a time, book it, release the rest, report in one line.
---

# schedule

The facts block at the top of every turn has the owner's name, your name, the time zone, the
owner's usual windows, whether the first message to a new person is shown first, and today's
date with the next two weeks and their weekdays. Take weekdays from that list, never compute
them. If the owner's name is missing there, run the first conversation in `AGENTS.md` first.

## 1. Understand the ask

From the owner's private chat: who (name and phone number, E.164), what (lunch, coffee, call,
a 30-min intro), how long, where (a place, a video link, "their office"), and by when. One
question for whatever is missing, all of it in one message. A phone number you were not
given is asked for, never guessed.

## 2. Find real slots

- With the owner's Mac connected: read the calendar for the window (`google-workspace` via
  `owners-mac`), and pick two or three free slots that fit the kind of meeting (lunch is
  12–1:30, coffee is mornings, calls are anywhere in the windows). Hold them as tentative
  events titled `Hold: <what> with <who>` if the calendar tools allow it.
- Without it: pick from `windows` and tell the owner these are unconfirmed.

Write every slot with the weekday, the date and the zone, and both zones when they differ:
"Tue Oct 7, 10:00–10:30am PT (1:00pm ET)". Check the weekday against the date and the year
before sending: a wrong date is worse than no date. Holds expire after 48 hours.

## 3. Text the other person, as the assistant

`plow_start_thread` with their number and the first message. The owner is added to the thread
automatically. The first message:

> Hi Patrick, this is Spruce, Sam's assistant (I'm an AI). Sam asked me to find a lunch next
> week. Sam is free Tue Sep 29, Wed Sep 30 or Thu Oct 1, 12–1pm PT. Which works best for you?

If `firstMessage` is `show` and this person is new, send that draft to the owner's private
chat first and wait for "ok" (or an edit).

## 4. The back and forth

Replies in that thread run in that room. Keep answering there, as the assistant: confirm the
slot they pick, offer the next ones if none fit, ask the owner privately for anything that is
not a time or a place. Your owner may write in the same thread; that is them, not you, and
you never answer in their name.

## 5. Moving or cancelling

When a meeting has to move, say so plainly and offer new slots in the same message: "Sam needs
to move Thursday, apologies for the shuffle. Would Tue Oct 7 or Wed Oct 8 at noon PT work?"
If the other person asks to move it, offer slots from the calendar; you never move a confirmed
meeting without your owner's ok.

## 6. Book it and report

- **Without the owner's Mac** (no calendar tools), the invite is a file. Run
  `node /opt/onbehalf/bin/invite.mjs --title "Lunch: Sam / Patrick" --date 2026-10-01 --time 12:00
  --minutes 60 --tz <the owner's zone> --where "<place or link>" --organizer "<owner>"
  --attendee "<Name> <email>"` (the attendee only if you have the email). It prints JSON with
  `when` and `media_line`. Reply in the thread with the one-line recap using `when` exactly as
  printed, then `media_line` on its own line: the file arrives in the thread and both people tap
  it to add the meeting. Never type the time yourself in the recap; copy `when`.
- **With the owner's Mac**, book the chosen slot on the owner's calendar with the other person's email if you have it
  (ask for it in the thread: "What email should I send the invite to?"), the place or the
  link, and a title both would recognize.
- Delete the other holds.
- Check the invite before announcing it: the right date and zone, the place or the link, and
  every guest on it. Then, in the thread, one recap: "Booked: Thu Oct 1, 12–1pm PT at Verve,
  Palo Alto. Invite sent to psalyer@mayfield.com." Only after the tool confirmed it.
- In the owner's private chat, one line: "Lunch with Patrick: Thu Oct 1, 12–1pm, Verve.
  Invite sent."
