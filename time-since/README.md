# time-since

Paseo 0.7 composer pill that ticks elapsed time since the last `user_message` or `assistant_message` in the agent thread.

It sits in the track above the composer. The clock is the last chat-message timestamp on the timeline, so it survives closing Paseo and reopening the workspace. It does not replace Paseo's message renderer.

Shows `4m 12s` for the first five minutes, then `12m` / `4h 12m` with no seconds. Hidden while a turn is running. Press the pill for the absolute timestamp.

Open **Time Since Options** in Command Center to show or hide the clock icon and add an optional `ago` suffix, such as `4m 12s ago`. The panel includes a preview. Changes apply to all workspaces on the connected host and persist across restarts. The icon starts on and the suffix starts off.

![time-since composer pill](composer-pill.png)

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
