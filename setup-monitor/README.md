<img src="https://raw.githubusercontent.com/stevecastaneda/paseo-plugins/main/setup-monitor/icon.png" alt="" width="64" height="64">

# setup-monitor

Paseo 0.9 live view of worktree setup. Paseo already tracks `worktree.setup` from `paseo.json`. After 0.3 it only opens the built-in Setup tab when that script fails, so a long `npm install` is silent. This plugin reads the same `workspace_setup_status` stream and shows it while it runs.

- A button in the workspace top bar from the moment the worktree opens, before you've sent a message: a spinner and elapsed time while setup runs, then a green check or a red alert. It stays until you dismiss it from the popover.
- Click it for a popover: each setup command with its status and duration, a live log, and the failure reason if it failed. Click a command to see its log.

<img src="popover.png" alt="The setup button in the workspace top bar with its popover open while setup runs" width="446">

## Install

```bash
paseo plugin add npm:@stevecastaneda/paseo-setup-monitor
```

Or from Paseo's plugin registry: `paseo plugin add stevecastaneda/setup-monitor`.

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

## Changelog

### 0.4.3

- The package description now says setup progress lives in a top-bar button. It used to say Explorer, where the plugin showed it before 0.4.0.

### 0.4.2

- The plugin's page in Paseo's plugin store now uses the plugin's own description instead of text the store copied from paseo.cafe.

### 0.4.1

- Installs again with npm 12. Installing failed with `npm ci` asking for a `package-lock.json`, because npm 12 no longer reads the lockfile this plugin shipped ([#53](https://github.com/stevecastaneda/paseo-plugins/issues/53)). The plugin no longer runs its own install step; Paseo's npm install already brings in what it needs.
- Install from npm or Paseo's plugin registry. Installing straight from GitHub no longer works.
