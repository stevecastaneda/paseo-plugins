---
name: paseo-progress
description: Keep the Paseo Progress dashboard current with the paseo-progress command. Use when implementing a spec or a set of tickets, running any job with more than 5 steps or over 30 minutes, or when the user asks for a progress dashboard.
---

# Paseo progress

The user watches a live dashboard in Paseo, drawn from the progress file in this worktree. You keep it true by running `paseo-progress` the moment each change happens: the dashboard is a side effect of the work, never a summary written afterwards. Run it from inside the worktree you are working in: it records to that worktree's dashboard, and `show` names the worktree it read. `paseo-progress --help` lists every command; `paseo-progress <command> --help` gives its options.

The user answers questions by reference ("Q7 A") and reads everything else at a glance, so every line you record is written for a product manager: plain words, no jargon.

## 1. Set up the run

Run `paseo-progress show`. When it shows an open run for this job, continue it. A run marked Finished is closed, even if it looks like your job; start a new one. Otherwise:

1. `paseo-progress start "<job title>"`, with `--subtitle` naming the spec or ticket folder.
2. Add every ticket in order with `paseo-progress ticket add "Ticket 01: <title>" --estimate <minutes>`, with `--waits-for T02` on any that can't start before another finishes. Keep the "Ticket NN:" prefix: the dashboard shortens titles to it. When a ticket is written up somewhere, a spec file or an issue, pass `--source <path or link>` so the user can open it from the ticket. For a job without tickets, add its steps instead and pass `--item-label Step` to `start`; give a step `--source` only when it has a write-up.
3. `paseo-progress activity add "<one line: what this run will do>"`.

Done when `show` lists every ticket or step with an estimate.

## 2. Work each ticket

Record each change as it happens, on the ticket's id from `show` (T01, T02, ...):

| When | Command |
| --- | --- |
| You start a ticket | `ticket update T03 --status working --stage Build` |
| You move to the next stage | `ticket update T03 --stage Review`, then `Fixes`, then `Verify` |
| Something reviewable lands (a screenshot folder, a screen recording, a report, a preview URL) | `deliverable add "<what it shows>" <path or URL> --ticket T03` |
| A milestone the user would want in the story | `activity add "<one line>" --ticket T03` |
| Between bigger events | `ticker set "<what you are doing right now>"` |
| The ticket is finished | `ticket update T03 --status done`, then start the next one |
| The plan drops it | `ticket update T03 --status skipped --note "<why>"` |

Pass `--ticket` on every activity, deliverable and question that belongs to a ticket. The user presses a ticket to see its story: each stage and how long it took, with the activity, deliverables and questions tagged to it. Leave it off only for run-wide notes.

Other sessions may add tickets (or steps) to the same run. When a command's output says another session added one, it is part of the plan: work it in order after your current one, the same as the ones you added.

A subagent records the work you hand it. Paseo shows you as idle while you wait on it, so its updates are the only sign the work is still going; after 15 minutes without one, the dashboard warns that the work may have stopped. Mark the ticket working, then put this in the subagent's prompt with this worktree's absolute path and the ticket id filled in:

```text
Record progress on the Paseo dashboard as you work:
- at each new stage: cd <worktree> && paseo-progress ticket update T03 --stage <stage>
- between stages:    cd <worktree> && paseo-progress ticker set "<what you are doing now>"
```

The `cd` puts the updates on this worktree's dashboard even when the subagent works in another checkout. When the subagent reports back, mark the ticket done.

Done when every ticket or step is done or skipped, or waits on an open question.

## 3. Ask questions

When a decision belongs to the user, ask it:

```sh
paseo-progress question ask "<short title>" "<the question, in one or two sentences>" \
  --option "A=<choice> | <what happens if they pick it>" \
  --option "B=<choice> | <what happens if they pick it>" \
  --recommend <letter> --ticket T03 --raised-by "Ticket 03 design review" \
  [--big "<which test below it meets, in a few plain words>"] \
  [--background "<what they need to decide without opening the worktree>"] \
  [--file <path or http(s) URL>=<what it shows>]
```

`question ask` prints the question mode the user picked in Paseo's Settings and what to do until the answer. Do exactly what it prints.

Decide `--big` before you ask, in every mode. A question is big when one of these tests holds for it, and only then:

1. Building your recommendation before the answer would mean something leaves this computer: pushing, publishing, deploying, changing live data, sending messages, spending money.
2. The answer sets something people or programs outside this repo will rely on: a saved data format, a database schema, a public API, command or setting name, or removing or renaming something people already use.
3. Most of the tickets or steps still ahead would be built on the answer.

Every other question is small, large code changes included, because git can undo them. When you can't name the test it meets, it's small. Give the test in the `--big` reason.

- When the user replies ("Q7 A", or in their own words), run `question answer Q7 A --words "<their words>"` and do what it prints.
- When a question is about how something looks, attach the screenshot, mockup or preview link with `--file`. Add more later with `question update Q7 --file <path>=<what it shows>`.
- When the user asks about a question, answer in chat and also put the explanation on the question with `question update Q7 --background "<text>"`, so the dashboard carries it too.
- `question remove Q7` withdraws a question that no longer applies.

## 4. Flag what is stuck

- A ticket that has to wait for another ticket in this run is just the order of work. Record it with `ticket add ... --waits-for T03` (or `ticket update T05 --waits-for T03`) and leave its status alone. The dashboard shows it calmly as waiting until T03 is done.
- A working ticket turns stuck on its own once it goes longer than its estimate without an update: a status, stage or note change, or activity tagged to it. When a ticket will run long, keep updating its stage, or raise its estimate with `--estimate`.
- A ticket held up by something outside the run (a service, access, a go-ahead from someone else): `ticket update T03 --status blocked --note "<what it waits on>"`. That shows as stuck. Set it back to `working` when it moves again. A decision that belongs to the user is a question: ask it as in section 3 and leave the ticket's status alone.
- A blocker outside any ticket (a failing service, a missing key): `stuck set "<reason>" [--ticket T03]`, then `stuck clear S1` once it is gone.

## 5. Finish

The job is over when the work is done and the user has answered every question. While questions wait on the user, the run stays open: tell the user in chat which ones, and leave them for the user to answer. When the job is over:

1. Mark the last ticket done or skipped.
2. Settle every open question: record the user's answer, or withdraw it with `question remove` when it no longer applies. Clear flagged blockers with `stuck clear`.
3. `paseo-progress finish "<one line: the outcome>"`. It refuses, and says what is still open, until the steps above are done.
4. Run `paseo-progress show`.

Done when `show` says Finished with the right outcome.
