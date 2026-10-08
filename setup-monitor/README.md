# setup-monitor

Paseo 0.9 live view of worktree setup. Paseo already tracks `worktree.setup` from `paseo.json`. After 0.3 it only opens the built-in Setup tab when that script fails, so a long `npm install` is silent. This plugin reads the same `workspace_setup_status` stream and shows it while it runs.

- A button in the workspace top bar from the moment the worktree opens, before you've sent a message: a spinner and elapsed time while setup runs, then a green check or a red alert. It stays until you dismiss it from the popover.
- Click it for a popover: each setup command with its status and duration, a live log, and the failure reason if it failed. Click a command to see its log.

## Install

```bash
paseo plugin add npm:@stevecastaneda/paseo-setup-monitor
```

Or from GitHub: `paseo plugin add stevecastaneda/paseo-plugins --path setup-monitor`.

Turn on **Settings → Plugins → Enable plugins** on the daemon first.

## Local development

```bash
cd setup-monitor
npm install
npm run typecheck
npm test
paseo plugin install "$PWD"
paseo plugin reload setup-monitor
```

## Updates

Workspace and agent changes arrive through subscriptions rather than repeated
list requests. Setup status refreshes every two seconds while the plugin is
active. Each workspace has at most one pending status request, and its button
and popover share that result instead of making separate requests.
