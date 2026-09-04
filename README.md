# Paseo plugins

Plugins for [Paseo](https://paseo.sh) 0.7. Each subdirectory is its own plugin. Install with `paseo plugin add owner/repo:path`.

Plugin code is trusted and unsandboxed. Server code runs as the daemon user. Client code runs inside Paseo.

## time-since

Composer pill that ticks elapsed time since the last chat message in the agent thread. It sits in the track above the composer.

Shows `4m 12s` for the first five minutes, then `12m` / `4h 12m` with no seconds. Hidden while a turn is running. Press the pill for the absolute timestamp.

![time-since composer pill](time-since/composer-pill.png)

```bash
paseo plugin add stevecastaneda/paseo-plugins:time-since
```

## setup-monitor

Live view of `worktree.setup` from `paseo.json`. While that script runs, Setup opens in Explorer so the chat tab stays selected. A composer pill shows progress and failure.

![setup-monitor in Explorer](setup-monitor/explorer.png)

```bash
paseo plugin add stevecastaneda/paseo-plugins:setup-monitor
```

Turn on **Settings → Plugins → Enable plugins** on the daemon first.

## Local development

```bash
cd time-since   # or setup-monitor
npm install
npm run typecheck
npm test
paseo plugin install "$PWD"
paseo plugin reload time-since
```

