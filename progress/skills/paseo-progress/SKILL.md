---
name: paseo-progress
description: Keep the Paseo Progress dashboard live with the paseo-progress command. Use when working through a spec or a set of tickets, on any job over 5 steps or 30 minutes, or when the user asks for a progress dashboard.
---

# Paseo progress

The user watches a live dashboard in Paseo for this worktree. Keep it live: run `paseo-progress` from inside the worktree the moment each change happens, so the dashboard is a side effect of the work. Write every line for a product manager, in plain words. `paseo-progress --help` is the reference for every command and flag.

## 1. Set up

Run `paseo-progress show` and continue an open run for this job. A Finished run is closed, so `start` a new one, then add every ticket in order:

- Title each `"Ticket 01: <title>"`. The dashboard shortens titles to that prefix.
- Give each an `--estimate`, plus `--waits-for` when it can't start before another and `--source` when a spec file or issue describes it.
- For a job without tickets, add its steps and pass `--item-label Step` to `start`.

Done when `show` lists every ticket with an estimate.

## 2. Work

Move each ticket through `--status working --stage Build`, then the stages `Review`, `Fixes` and `Verify`, then `--status done`. Along the way, record what the user would want to see: `deliverable add` for anything reviewable, `activity add` for milestones, `ticker set` for what you are doing right now. Tag each with `--ticket` unless it covers the whole run.

- A ticket past its estimate with no update turns stuck. Keep its stage current, or raise its `--estimate`.
- A ticket another session adds is part of the plan. Work it in order.
- `--status blocked` and `stuck set` are for things outside the run, like a service that's down or missing access.
- Put this in a subagent's prompt, with the worktree path and ticket id filled in. While you wait on it, its updates are the dashboard's only sign the work is moving:

  ```text
  Record progress on the Paseo dashboard as you work:
  - at each new stage: cd <worktree> && paseo-progress ticket update T03 --stage <stage>
  - between stages:    cd <worktree> && paseo-progress ticker set "<what you are doing now>"
  ```

Done when every ticket is done or skipped, or waits on a question.

## 3. Ask

When a decision belongs to the user, ask it with `question ask`, lettered `--option`s and your `--recommend`. Read `paseo-progress question ask --help` before your first question. It defines a big question, which you mark with `--big "<the test it meets>"`.

The user picks the question mode in Paseo's Settings, and `question ask` prints what that mode means for this question. Do what it prints. Record the user's reply ("Q7 A", or their own words) with `question answer Q7 A --words "<their words>"`, and do what that prints too.

- When the question is about how something looks, attach the screenshot or link with `--file`.
- When the user asks about a question, answer in chat and add the explanation with `question update Q7 --background`. If explaining it changes your mind, also pass `--recommend` with the new option, say in `--background` what changed, and do what it prints.

## 4. Finish

The job is over when every ticket is done or skipped and every question is answered. While questions wait on the user, leave the run open and tell the user in chat which ones. Then run `paseo-progress finish "<one-line outcome>"`, and settle whatever it lists if it refuses.

Done when `show` says Finished with the right outcome.
