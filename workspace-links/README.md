# Workspace Links

A small Paseo 0.8 plugin that reads `workspace-links.json` from the active workspace and puts those URLs on the Links trigger. Press the composer pill or header button and choose a URL to open it in the host browser. **Manage links** (or **Add links** when the file is empty or missing) opens the setup panel in Explorer. The Command Center item **Workspace Links** opens that panel too.

The trigger stays available when the workspace has no links yet, so the setup guide is always one menu item away. The panel never opens automatically.

Under **Show as**, switch between the composer pill and a workspace header button. Header buttons can hide the **Links** label. Changes apply to all workspaces on the connected host and persist across restarts. The composer pill is the default.

![workspace-links in Explorer](explorer.png)

## Install

```sh
paseo plugin add stevecastaneda/paseo-plugins --path workspace-links
```

Enable plugins under **Settings → Plugins** on the Paseo host.

## Configuration

Put this file at the workspace root:

```json
[
  { "label": "App", "url": "http://localhost:3000" },
  { "label": "Admin", "url": "http://localhost:3001" },
  { "label": "Docs", "url": "https://example.com/docs" }
]
```

Use fixed URLs or have your existing setup/dev script generate this same file with the workspace's current URLs. Gitignore it if it contains workspace-specific values. The Links menu rereads the file on its own. Click **Refresh** in the panel if that list still looks stale. The plugin does not execute scripts.

Links open in the **default browser on the machine running the Paseo daemon**. Set Chrome as that machine's default browser if you prefer Chrome. No terminal tab, browser selector, or extra runtime dependency is needed.

The plugin uses macOS's `open`, Windows PowerShell's `Start-Process`, or Linux's `xdg-open`. The host needs a graphical desktop and a configured default browser; Linux also needs `xdg-open`. No special WSL or headless-server integration is included.

For remote workspaces, the browser opens on the remote host. `localhost` therefore refers to that host, not the device viewing Paseo. A successful launcher exit confirms the request, not that the page loaded.

Only HTTP(S) URLs are supported, with up to 100 links. Missing configuration, empty lists, and invalid files have visible panel states.

## Local development

```sh
cd workspace-links
npm install
npm run typecheck
npm test
paseo plugin install "$PWD"
paseo plugin reload workspace-links
```

Enable plugins in Paseo's settings. In PowerShell, use `(Get-Location).Path` in place of `"$PWD"` if needed.

The package manifest is required for the Paseo plugin's SDK and development types. There are no additional runtime dependencies.
