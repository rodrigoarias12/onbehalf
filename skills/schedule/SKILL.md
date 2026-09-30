---
name: schedule
description: Set up a meeting on the owner's behalf by text. Find real slots, text the other person as the owner's assistant (never as the owner), agree a time, book it, release the rest, report in one line.
---

# schedule

The facts block at the top of every turn has the owner's name, your name, the time zone, the
owner's usual windows, whether the first message to a new person is shown first, and today's
date with the next two weeks and their weekdays. Take weekdays from that list, never compute
them. If the owner's name is missing there, run the first conversation in `AGENTS.md` first.

## 0. Every step leaves a record

One page per contact, kept by `node /opt/onbehalf/bin/pipeline.mjs` (the facts block lists the
open ones with what is due). Record what HAPPENED, never what you intend, right after it happens:

- the ask arrives → `set <contact> --contact "Juan" --handle +1… --status waiting_on_us --meeting "coffee, 60 min, in person"`
- holds created → `--status held --holds "<event id>; <event id>; …"` (every hold and travel block)
- first text sent → `--status sent --chat <cht_…> --proposed "<the times exactly as sent>"`.
  The script checks with Plow that it was delivered; if not, it records `unverified` and says so.
  Tell the owner what it recorded, not what you hoped.
- they answer → `--status waiting_on_us`; you answer back → `--status waiting_on_them --chat <cht_…>`
- a nudge sent → `--nudged --note "nudge 1"`
- booked → `--status confirmed --holds "" --note "Thu Oct 1 12–1pm PT, invite sent"`
- they decline or stop → `passed` or `do_not_contact`

`next_step` is advice for later (`--next "…"`), never a claim that something happened.

## 1. Understand the ask

From the owner's private chat: who (name and phone number, E.164), what (lunch, coffee, call,
a 30-min intro), how long, where (a place, a video link, "their office"), and by when. One
question for whatever is missing, all of it in one message. A phone number you were not
given is asked for, never guessed.

## 2. Find real slots

- With the calendar connected (the facts say so): `node /opt/onbehalf/bin/freebusy.mjs --from
  <first day> --days <how many> --minutes <length>`. It reads the calendar itself and prints free
  slots inside the owner's hours, each with a `label` to copy and the `date`/`time` to book with.
  Offer two or three of them, copying the labels. You never see what fills the calendar.
- With the owner's Mac connected instead: read the calendar for the window (`google-workspace` via
  `owners-mac`) across every calendar the owner shows, and pick exactly three free slots that fit
  the kind of meeting (lunch is 12–1:30, coffee is mornings, calls are anywhere in the windows).
  Hold all three: one busy event each, titled `HOLD — <who>`, description `Tentative — no
  invitation sent`, no attendees, notifications off. For an in-person meeting, also block the
  owner's travel buffer (the facts say how long) before and after each hold, titled
  `Travel — <who>`. Fetch each created event, and record every id with `pipeline.mjs set …
  --status held --holds "…"` before sending anything. Holding is never sending.
- Without either: pick from the owner's hours and say these are unconfirmed.

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

Then check that it arrived: `node /opt/onbehalf/bin/delivery.mjs --wait 45`. The line is
iMessage only, and a number without iMessage never gets the text while it still shows as sent.
Tell the owner what the script says, in one line:
- `arrived: true` → "It reached Juan. I'll let you know when he answers."
- `not_arriving: true` → "It didn't reach Juan: that number most likely has no iMessage. Do you
  have another iMessage address for him, another number or the email of his Apple ID?"
- neither yet → "Sent to Juan; not delivered yet. I'll check again."

Never say it arrived before the script does. Never offer SMS, WhatsApp or email: this line
cannot send them.

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
- For a video meeting, use the owner's stored provider (`video` in the facts): Google Meet is
  added on the create itself; a personal Zoom room is the link the owner saved. Never pick a
  provider yourself and never ask twice: if it is not set, ask the owner once, privately, and
  save it in `onbehalf.json`.
- Once the invite is verified, delete every hold AND travel block on the contact's page
  (`pipeline.mjs show <contact>` lists them in `holds`), including the one at the chosen time,
  then record `--status confirmed --holds ""`. A partial delete stops there and goes to the owner.
- Check the invite before announcing it: the right date and zone, the place or the link, and
  every guest on it. Then, in the thread, one recap: "Booked: Thu Oct 1, 12–1pm PT at Verve,
  Palo Alto. Invite sent to psalyer@mayfield.com." Only after the tool confirmed it.
- In the owner's private chat, one line: "Lunch with Patrick: Thu Oct 1, 12–1pm, Verve.
  Invite sent."
