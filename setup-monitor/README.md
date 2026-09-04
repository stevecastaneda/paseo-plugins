# setup-monitor

Paseo 0.7 live view of worktree setup. Paseo already tracks `worktree.setup` from `paseo.json`. After 0.3 it only opens the built-in Setup tab when that script fails, so a long `npm install` is silent. This plugin reads the same `workspace_setup_status` stream and shows it while it runs.

- Auto-opens Setup in Explorer while `worktree.setup` is running, so the main chat tab stays selected.
- Composer pill while setup is running or failed. Click it to open Setup in Explorer.
- Setup panel: command rows, live log, check when it finishes, alert if it fails. Command Center opens it in Explorer too.

```bash
paseo plugin add stevecastaneda/paseo-plugins:setup-monitor
```

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
