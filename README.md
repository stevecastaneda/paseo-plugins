# Paseo plugins

Plugins for [Paseo](https://paseo.sh) 0.7. Each subdirectory is its own plugin. Install with `paseo plugin add owner/repo:path`.

Plugin code is trusted and unsandboxed. Server code runs as the daemon user. Client code runs inside Paseo.

## time-since

Composer pill that ticks elapsed time since an agent's last activity. It sits in the track above the composer, so it tracks the current chat rather than every historical message.

- Idle, error, or closed: `4h 12m ago`
- Running or initializing: `working 4h 12m`
- Press the pill for the absolute timestamp

```bash
paseo plugin add stevecastaneda/paseo-plugins:time-since
```

Turn on **Settings → Plugins → Enable plugins** on the daemon first.

## Local development

```bash
cd time-since
npm install
npm run typecheck
npm test
paseo plugin install "$PWD"
paseo plugin reload time-since
```
