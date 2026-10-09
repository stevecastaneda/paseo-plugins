# Progress

A plugin for Paseo 0.9 and later that gives each worktree a live progress dashboard. Agents record progress with the `paseo-progress` command, which adds one line per change to the worktree's progress file. That file lives outside the repo, so git never sees it. The **Progress** panel draws the dashboard from that file and updates by itself.

<img src="images/1-panel.png" alt="The Progress panel in Explorer" width="400">

The dashboard shows:

- the run's title, a headline ("2 of 4 tickets done, 5 questions waiting for you, 1 stuck"), a one-line "now" ticker, and when it was last updated
- a "possibly stale" warning after 15 minutes with no update while tickets remain, unless Paseo shows an agent in the workspace still running, and never once every ticket is done or skipped or the run is finished; working items swap their spinner for a pulsing amber warning
- percent of estimated work done, time done of time estimated (like "1 h 30 min of 2 h"; once everything is done, how long it really took), and a bar with one segment per ticket
- **Stuck:** blocked tickets, working tickets with no update for longer than their estimate, and blockers the agent flags
- **Tickets:** estimate, status, and the working ticket's stage. A ticket that waits for another (`--waits-for T03`) shows "Waits for Ticket 03" under its title until that one is done; waiting is the order of work, so it never counts as stuck, even if the agent also marked it blocked. Press a ticket for its story in a dialog. A summary on top shows its status and stage, time worked against the estimate as a bar that turns red past it, the agent's latest status line while it's working, and the agent on it. Tabs below hold the rest, each only when it has something: the ticket's write-up when it has a `--source` file (the start of it, with the rest a press away), a timeline of its stages and statuses with how long each took, and the activity, questions and deliverables that belong to it. The agent on a ticket shows by its chat title; pressing it opens that chat. Items tagged with `--ticket` belong exactly; older, untagged ones are matched by when they happened and marked "by time"
- **Questions:** each with a permanent reference (Q1, Q2, ...), lettered options, and the option the agent recommends. The agent builds nothing a question affects until you answer; it works on other things meanwhile, and stops when nothing else is left. Press a question to open it in a dialog, then press **Copy Q2 B** to copy `Q2 (title): B` for your reply. Files and links the agent attached (`--file`) open like deliverables: images and text files preview in Paseo (with **Back** to the question), links open in Paseo's browser, and other files open in their default app. From the pill's popover, the preview opens over the popover, which stays open so you can go back to it. Answers stay listed under the same reference.
- **Activity**, **Answered** questions and **Deliverables** (press one to open it), sharing one card with a tab for each; the panel remembers the tab you picked. Each shows the newest 10, with **Show 10 older** below

The panel lives in Explorer, beside the agent chat, so you can watch both. Open it from Command Center with **Open Progress**. When questions are waiting or something is stuck, a pill above the message box shows it (`3 questions · 1 stuck`). Pressing it opens a popover with each open question, its choices and their Copy buttons, and what is stuck, so you can answer without leaving the chat. **Open Progress** at the bottom opens the panel in Explorer.

On phones, where Paseo has no Explorer pane, Progress opens as a tab of its own, and the pill stays above the message box while a run is open so there's always a way in. SVG files preview on desktop; on phones they open on the daemon host.

The first time a run starts in a worktree whose Progress panel has never been opened, the pill shows a spinner and reads **Progress** instead; pressing it opens the panel. Once the panel has been opened there, the plugin writes an empty `progress-panel-opened` file next to the progress file and the nudge never comes back, even for later runs. It doesn't open the panel by itself because Paseo switches to a workspace to open its panel, which would pull you away from whatever you're looking at.

## Install

```sh
paseo plugin add npm:@stevecastaneda/paseo-progress
```

Or from Paseo's plugin registry: `paseo plugin add stevecastaneda/progress`.

Enable plugins under **Settings → Plugins** on the Paseo host. You need Node.js 22.18 or later on the daemon host.

Then install the `paseo-progress` command agents run. Open **Progress** from Command Center and press **Install command** in the banner. It adds one file, `~/.local/bin/paseo-progress`, on the machine running the Paseo daemon, and the banner disappears once agents can run it. The plugin writes nothing until you press it, and it never replaces a file something else put at that path.

To install from a terminal instead, or to put the command somewhere else:

```sh
dir="$(paseo plugin ls progress --json | node -pe 'JSON.parse(require("fs").readFileSync(0))[0].path')"
node "$([ -f "$dir/dist/server/cli.js" ] && echo "$dir/dist/server/cli.js" || echo "$dir/server/cli.ts")" install-launcher [path]
```

If `paseo` isn't on your `PATH`, use `/Applications/Paseo.app/Contents/Resources/bin/paseo`. The command doesn't name a plugin folder: each run asks Paseo (`paseo plugin ls`) which copy of the plugin it is running and runs that copy, so it keeps working after updates and `npm run dev` switches. The npm package carries the command compiled to JavaScript in `dist/`, because Node won't run TypeScript from `node_modules`.

## Where progress is kept

Each worktree's progress lives outside the repo, in its own folder under `~/.local/state/paseo-progress/` on the daemon host. There's nothing to set up and nothing to hide: git never sees these files, and the plugin never edits a `.gitignore` or git's exclude file. The panel's empty state shows the exact path.

### Saving run history to the repo

If you want to keep runs, at the bottom of the panel press **Save to repo…** and pick a folder (or name a new one). From then on, each run is saved as its own file there, like `history/20261001-064512-export-feature.jsonl`, and updated as the run goes. Commit them like any other file. One file per run means two branches never write the same file, so merges don't conflict. The lock and the panel marker never go there.

The choice covers every worktree of the repo and is kept in the repo's local git config (`paseo-progress.saveRuns`), which nothing commits. **Change…** picks another folder for future runs; **Stop saving** turns it off. Files already saved are never moved or deleted.

### Upgrading from 0.1.x

Earlier versions kept progress in `.scratch/` in each worktree, hidden by a `.scratch/.gitignore` they wrote. The first time the command or the panel touches a worktree after the upgrade, the plugin moves its files out of `.scratch/` and removes that `.gitignore` if it's exactly the one the plugin wrote. If `.scratch/` is then empty, it goes too; anything else you keep there stays. If git tracks the old progress file (for example, an agent committed it), the plugin leaves it where it is and keeps using it, so nothing changes in that repo.

## Agent skill

The plugin ships an agent skill, `paseo-progress`, that tells agents when to run each command during a multi-ticket job: set up the run, move tickets through their stages, ask questions without stopping, flag stuck work, and finish. Press **Install skill** in the Progress panel. It links `paseo-progress` into `~/.agents/skills`, `~/.claude/skills`, and `~/.codex/skills` (the folders Paseo installs its own skills into), pointing at the copy of the plugin Paseo runs, so plugin updates reach agents. If Paseo later runs the plugin from somewhere else, the button changes to **Update skill**. It never replaces a skill it didn't link; that folder is skipped.

From a terminal instead:

```sh
skill="$(paseo plugin ls progress --json | node -pe 'JSON.parse(require("fs").readFileSync(0))[0].path')/skills/paseo-progress"
for dir in ~/.agents/skills ~/.claude/skills ~/.codex/skills; do mkdir -p "$dir" && ln -s "$skill" "$dir/paseo-progress"; done
```

## Recording progress

Run `paseo-progress --help` for every command, and `paseo-progress <command> --help` for one. Commands find the worktree root from the current directory.

```sh
paseo-progress start "Loan Options snapshots" --subtitle "4 tickets"
paseo-progress ticket add "Ticket 01: Saved table" --estimate 120 \
  --source specs/01-saved-table.md                                     # Added T01
paseo-progress ticket update T01 --status working --stage Build
paseo-progress ticket update T01 --stage Fixes
paseo-progress ticket update T01 --status done
paseo-progress question ask "Row spacing" "Even out the card spacing?" \
  --option "A=Even it out | Cards look balanced" \
  --option "B=Leave it | No change" \
  --recommend A --raised-by "Ticket 01 design review"                   # Asked Q1
paseo-progress question answer Q1 A --words "Even it out."
paseo-progress deliverable add "Browser check screenshots" .scratch/shots/ --ticket T01
paseo-progress activity add "Saved table matches the design now." --ticket T01
paseo-progress ticker set "Running the browser check"
paseo-progress stuck set "Staging is down" --ticket T01                 # Flagged S1
paseo-progress show
paseo-progress finish "Snapshots ship for all four tables"
```

- Statuses are `not_started`, `working`, `blocked`, `done`, and `skipped`. Skipped tickets leave the totals.
- `ticket add` and `ticket update` take an optional `--source <path or link>[=<label>]`: where the ticket is written up, like its spec file or issue. It shows under the ticket's status in its dialog and opens like a deliverable. `--source ""` clears it. Tickets without one are fine.
- A working ticket is stuck once it goes longer than its estimate without an update, timed from its last status, stage or note change, or activity tagged to it. The ticket's dialog still shows total time worked against the estimate.
- `question ask` needs `--recommend`, the agent's pick. The question dialog tags that option "Recommended".
- Deliverable paths are stored relative to the worktree root. Web links open in Paseo's browser. Pressing an image (PNG, JPEG, GIF, WebP, up to 10 MB) or text deliverable (Markdown, text, logs, JSON, YAML, CSV; the first 256 KB) previews it in a dialog inside Paseo, which also works from a phone; **Open** there opens the file in its default app. Pressing any other local deliverable opens it with its default app on the machine running the Paseo daemon (for example HTML in your browser and folders in the file manager). On macOS, **Open** sends text files to your default browser. Only recorded deliverables inside the worktree open this way; otherwise the path is copied. The copy icon on each row copies the path.
- Several agents can share one run. When another session adds a ticket, each agent sees it at the end of its next command's output (and in `show`), and the skill has it work that ticket in order after its current one. An agent only hears about tickets added since its own last update in the run, and only once.
- Subagents record their own progress. Since Paseo 0.11, an agent waiting on background subagents shows as idle, so only the subagents' updates show the work is still going. The skill has the agent give each subagent the worktree path and ticket id, and the subagent records its stages and a ticker line on that worktree's dashboard.
- `start` begins a fresh dashboard. Earlier runs stay in the file. Question references stay unique across runs.
- `finish "<outcome>"` closes the run once every ticket is done or skipped, no question is open, and nothing is flagged stuck; otherwise it says what is left. The run stays on the dashboard, marked Finished with its outcome, and takes no more updates, so the next agent in the worktree starts a new run instead of adding to it.

## The progress file

The progress file, `progress.jsonl`, holds one JSON event per line, each with a version (`v`), a UTC timestamp (`ts`) from the real clock, and a `type`. Events written by a Paseo agent also carry its agent id (`by`). It is only ever appended to, so you can read or diff the history. A half-written last line is ignored. Other bad lines are skipped and listed in a small notice in the panel while the rest still renders. A lock keeps two commands from writing at once or handing out the same id.

## Limitations

- An agent hears about tickets other sessions added only when it next runs `paseo-progress`. One in the middle of a long step finds out when that step ends.
- Nothing updates unless the agent runs `paseo-progress`. Agents need the skill, and an agent that skips the command leaves the dashboard behind.
- On Paseo 0.11 and later, an agent waiting on background subagents counts as idle. If those subagents record nothing, the dashboard shows "possibly stale" after 15 minutes while they're still working.
- The command runs on the machine that hosts the Paseo daemon, and it needs Node.js 22.18 or later there.
- Each worktree keeps its own dashboard. There's no view across worktrees.
- Progress folders outside the repo stay behind when a worktree is deleted. They're small, and you can delete them from `~/.local/state/paseo-progress/`.
- Paseo can't open a panel without switching you to its workspace. So a new run shows a "Progress" pill, and you open the panel yourself.
- Pills check busy worktrees every 5 seconds and quiet ones every 30. In a quiet worktree, a new question can take up to half a minute to show.
- Previews cover images up to 10 MB and the first 256 KB of a text file. Other files open in their default app.
- Stale warnings and overdue times use the daemon host's clock.

## Local development

```sh
cd progress
npm install
npm run dev
```

`npm run dev` type-checks and tests the plugin, then points Paseo at this folder. The tests run the agent's commands in a throwaway worktree and read back the dashboard the panel would get.

## Changelog

### 0.3.3

- The skill now has subagents record their own progress, so the dashboard stops warning "possibly stale" while they work. Since Paseo 0.11, an agent waiting on background subagents shows as idle. After 15 minutes with no update, the dashboard said the work may have stopped even though the subagents were still at it. Now the agent gives each subagent the worktree path and ticket id, and the subagent records its stages and a ticker line. If the Progress panel shows **Update skill** after you update, press it so agents get the new instructions.

### 0.3.2

- The plugin's page in Paseo's plugin store now uses the plugin's own description instead of text the store copied from paseo.cafe.

### 0.3.1

- Installs again with npm 12. Installing failed with `npm ci` asking for a `package-lock.json`, because npm 12 no longer reads the lockfile this plugin shipped ([#53](https://github.com/stevecastaneda/paseo-plugins/issues/53)). The plugin no longer runs its own install step; Paseo's npm install already brings in what it needs.
- Install from npm or Paseo's plugin registry. Installing straight from GitHub no longer works.
