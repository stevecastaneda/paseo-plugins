Setup Monitor shows your worktree's setup commands while they run, so a long dependency install is no longer silent. These are the commands under `worktree.setup` in `paseo.json`. Needs Paseo 0.9 or later.

While setup runs, a button in the workspace header shows a spinner and a timer, even before the worktree has an agent. Click it for a popover with the live log. When setup has more than one command, each gets a row with its status and how long it took. Click a row to see that command's log.

When setup finishes, the button turns into a green check with the total time and stays until you dismiss it. If setup fails, the button turns red and the popover says why. That includes failures from before you opened Paseo. A failure you dismissed comes back after Paseo reloads, and a rerun brings the button back too.

The plugin only reads setup status from the Paseo daemon. It can't rerun or cancel setup, and it sends nothing anywhere else. The log shows everything your setup prints, secrets included, and keeps only the last 8,000 characters. The plugin checks every two seconds, so a setup that finishes faster may never appear. There are no settings.
