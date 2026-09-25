# Paseo plugins

Plugins for [Paseo](https://paseo.sh). Each plugin lives in its own directory and can be installed independently.

| Plugin | What it adds |
| --- | --- |
| [time-since](time-since/README.md) | Elapsed time since the last chat message, shown above the composer. |
| [setup-monitor](setup-monitor/README.md) | Live worktree setup progress and logs in Explorer. |
| [workspace-links](workspace-links/README.md) | Quick access to workspace URLs from a JSON file. |
| [history](history/README.md) | Inspect chat messages, tools, and raw session records from a composer pill. |

## Install

Turn on **Settings → Plugins → Enable plugins** on the Paseo daemon host. Run the install command below for each plugin you want.

Plugin code is trusted and unsandboxed. Server code runs as the daemon user. Client code runs inside Paseo.

## time-since

Composer pill that ticks elapsed time since the last chat message in the agent thread. It sits in the track above the composer.

Shows `4m 12s` for the first five minutes, then `12m` / `4h 12m` with no seconds. Hidden while a turn is running. Press the pill to open a popover with the absolute timestamp.

Open **Time Since Options** in Command Center to customize the clock icon and optional `ago` suffix. See the [plugin README](time-since/README.md) for details.

<img src="time-since/composer-pill.png" alt="time-since composer pill" width="336">

```bash
paseo plugin add stevecastaneda/paseo-plugins --path time-since
```

## setup-monitor

Live view of `worktree.setup` from `paseo.json`. While that script runs, Setup opens in Explorer so the chat tab stays selected. A composer pill shows progress and failure.

<img src="setup-monitor/explorer.png" alt="setup-monitor in Explorer" width="451">

```bash
paseo plugin add stevecastaneda/paseo-plugins --path setup-monitor
```

## workspace-links

Browser links for each workspace, supplied by `workspace-links.json` at the workspace root. The Links composer pill and header button open a menu of those URLs. Choose one to launch it, or **Manage links** for the setup panel. **Workspace Links** in Command Center opens that panel too. The panel still has the setup guide and a control to use the composer pill or a header button. That placement is shared by every workspace on the host and survives restarts.

Links open in the default browser on the **machine running the Paseo daemon** (macOS, Windows, or Linux). For remote workspaces, that means the remote host; `localhost` refers to that host too.

See [Workspace Links](workspace-links/README.md) for configuration.

<img src="workspace-links/explorer.png" alt="workspace-links in Explorer" width="890">

```bash
paseo plugin add stevecastaneda/paseo-plugins --path workspace-links
```

## Local development

Paseo runs each plugin from one folder on your machine. `npm run dev` makes Paseo run the plugin from the folder you're in. You need Node.js 22.18 or later.

**1. Point Paseo at your copy.** From the plugin's folder in your checkout or worktree:

```bash
cd time-since   # or setup-monitor, workspace-links, or history
npm install     # first time in this copy, and after pulling dependency changes
npm run dev
```

It ends with `time-since: running from <this folder>`. The change is live in the open Paseo app. You don't need to restart anything.

**2. Edit, then run `npm run dev` again.** Each run type-checks and tests the plugin first. If either fails, Paseo keeps running the last version that passed.

**3. Point Paseo back at your main copy when you're done.** Do this before you archive a worktree. If the folder is deleted while Paseo still uses it, the plugin stops loading.

```bash
cd path/to/main/paseo-plugins/time-since
npm install
npm run dev
```

To see which copy Paseo is using, run `paseo plugin ls`. If `paseo` isn't on your `PATH`, use `/Applications/Paseo.app/Contents/Resources/bin/paseo`. `npm run dev` finds it either way.

| Problem | Fix |
| --- | --- |
| `npm run typecheck failed` in a copy you didn't edit | Its dependencies are out of date. Run `npm install`, then `npm run dev` again. |
| Checks pass but the plugin isn't `running` | Run `paseo plugin logs <plugin>` to see why it didn't start. |

Switching copies keeps what a plugin saved in `~/.paseo/plugin-data/`.

## Versioning

Each plugin versions itself in that directory's `package.json`, starting at `0.1.0`. Paseo Cafe uses that field as the update identity, so bump it whenever you ship a change to that plugin. Sibling plugins and the git tag on this repository do not count.

Do not cut a GitHub Release for the whole repo. A plugin update is: increment that plugin's `package.json` (and matching `package-lock.json`), merge to `main`. Cafe's next scan picks it up. `paseo plugin update` still pulls the tracked git branch.
