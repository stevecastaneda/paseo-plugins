---
name: paseo-progress
description: Record progress on the Paseo Progress dashboard with the paseo-progress command. Use when implementing a spec or a set of tickets, running any job with more than 5 steps or over 30 minutes, or when the user asks for a progress dashboard.
---

# Paseo progress

The user watches a live dashboard in Paseo, drawn from the progress file in this worktree. You keep it true by running `paseo-progress` the moment each change happens: the dashboard is a side effect of the work, never a summary written afterwards. Run it from inside the worktree you are working in: it records to that worktree's dashboard, and `show` names the worktree it read. `paseo-progress --help` lists every command; `paseo-progress <command> --help` gives its options.

The user answers questions by reference ("Q7 A") and reads everything else at a glance, so every line you record is written for a product manager: plain words, no jargon.

## 1. Set up the run

Run `paseo-progress show`. When it shows a run for this job, continue it. Otherwise:

1. `paseo-progress start "<job title>"`, with `--subtitle` naming the spec or ticket folder.
2. Add every ticket in order with `paseo-progress ticket add "Ticket 01: <title>" --estimate <minutes>`. Keep the "Ticket NN:" prefix: the dashboard shortens titles to it. For a job without tickets, add its steps instead and pass `--item-label Step` to `start`.
3. `paseo-progress activity add "<one line: what this run will do>"`.

Done when `show` lists every ticket with an estimate.

## 2. Work each ticket

Record each change as it happens, on the ticket's id from `show` (T01, T02, ...):

| When | Command |
| --- | --- |
| You start a ticket | `ticket update T03 --status working --stage Build` |
| You move to the next stage | `ticket update T03 --stage Review`, then `Fixes`, then `Verify` |
| Something reviewable lands (a screenshot folder, a report, a preview URL) | `deliverable add "<what it shows>" <path or URL> --ticket T03` |
| A milestone the user would want in the story | `activity add "<one line>"` |
| Between bigger events | `ticker set "<what you are doing right now>"` |
| The ticket is finished | `ticket update T03 --status done`, then start the next one |
| The plan drops it | `ticket update T03 --status skipped --note "<why>"` |

A working ticket turns stuck on its own once it runs past its estimate. When the new estimate is known, raise it with `--estimate`.

## 3. Ask questions without stopping

When a decision belongs to the user, ask it and keep working:

```sh
paseo-progress question ask "<short title>" "<the question, in one or two sentences>" \
  --option "A=<choice> | <what happens if they pick it>" \
  --option "B=<choice> | <what happens if they pick it>" \
  --default <letter> --raised-by "Ticket 03 design review" \
  [--background "<what they need to decide without opening the worktree>"] \
  [--file <path or http(s) URL>=<what it shows>]
```

- The default is the safest choice. Carry on with it straight away.
- Add `--waits` when acting on any choice needs the user's yes: purchases, production, live vendor calls, commits. Then work on something else until they answer.
- When the user replies ("Q7 A", or in their own words), run `question answer Q7 A --words "<their words>"`. The command reports whether the answer differs from the default; when it does, change course before anything else.
- When a question is about how something looks, attach the screenshot, mockup or preview link with `--file`. The user opens it from the question: images preview in Paseo, links open in its browser. Add more later with `question update Q7 --file <path>=<what it shows>`.
- When the user asks about a question, answer in chat and also put the explanation on the question with `question update Q7 --background "<text>"`, so the dashboard carries it too.
- `question remove Q7` withdraws a question that no longer applies.

## 4. Flag what is stuck

- A ticket waiting on something: `ticket update T03 --status blocked --note "<what it waits on>"`. Set it back to `working` when it moves again.
- A blocker outside any ticket (a failing service, a missing key): `stuck set "<reason>" [--ticket T03]`, then `stuck clear S1` once it is gone.

## 5. Finish

1. Mark the last ticket done or skipped.
2. `ticker clear`, and `activity add "<one line: the outcome>"`.
3. Run `paseo-progress show`.

Done when `show` matches reality: no ticket is still working, nothing is stuck that isn't, and every open question is one the user still has to answer.
