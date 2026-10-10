Progress gives each worktree a live dashboard for long agent jobs. The agent records its tickets or steps with a `paseo-progress` command, along with what's stuck, questions for you and finished work. The Progress panel in Explorer shows all of it. Needs Paseo 0.9 or later, and Node.js 22.18 or later on the computer running the Paseo daemon.

The panel shows how much of the estimated work is done, what the agent is doing right now, and where each ticket stands. A ticket turns stuck when it's blocked or runs past its estimate without an update. Press a ticket to see its timeline, activity, questions and deliverables. Images and text files the agent records open in a preview inside Paseo.

When the agent needs a decision, it asks a numbered question with lettered options and says which one it recommends. A pill above the message box counts open questions and stuck work. Each option has a Copy button. Paste the answer into the chat and the agent records it.

Nothing updates unless the agent runs the command, so agents need the plugin's skill. The panel has two setup buttons, and each one shows where it will write before you press it:

- Install command writes `~/.local/bin/paseo-progress` on the daemon host.
- Install skill links the plugin's `paseo-progress` skill into `~/.agents/skills`, `~/.claude/skills` and `~/.codex/skills`. New agent sessions pick it up.

Both work from files inside the plugin and download nothing. Neither one replaces a file you made.

Progress keeps each worktree's data under `~/.local/state/paseo-progress/` on the daemon host, outside the repo. You can also save runs into the repo. Pick a folder and Progress writes each run there too, and it remembers the folder in the repo's local git config. There's no view across worktrees, and a deleted worktree's folder stays behind until you remove it.
