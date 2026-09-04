# time-since

Paseo 0.7 composer pill that ticks elapsed time since an agent's last activity.

It sits in the track above the composer, so it tracks the current chat rather than every historical message. Transforming `user_message` / `assistant_message` rows would replace Paseo's own message renderer, which this plugin does not do.

- Idle, error, or closed: `4h 12m ago`
- Running or initializing: `working 4h 12m`
- Press the pill for the absolute timestamp

## Install

Paseo 0.7.x. Enable plugins in **Settings → Plugins**, then:

```bash
paseo plugin add stevecastaneda/paseo-plugins:time-since
```

From a local checkout:

```bash
npm install
npm run typecheck
paseo plugin install /absolute/path/to/time-since
```

After source changes:

```bash
npm run typecheck
paseo plugin reload time-since
```
