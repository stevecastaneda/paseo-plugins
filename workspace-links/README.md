# Workspace Links

A small Paseo plugin (0.9 or later) that reads `workspace-links.json` from the active workspace and puts those URLs on the Links trigger. Press the composer pill or header button to see each link's name with its URL underneath, then choose one to open it in your browser, or copy its URL. The settings button in the popover (or **Add links** when the file is empty or missing) opens the setup panel in Explorer. The Command Center item **Workspace Links** opens that panel too.

The trigger stays available when the workspace has no links yet, so the setup guide is always one click away. The panel never opens automatically.

Under **Show as**, switch between the composer pill and a workspace header button. Header buttons can hide the **Links** label. Changes apply to all workspaces on the connected host and persist across restarts. The composer pill is the default.

![workspace-links in Explorer](explorer.png)

## Install

```sh
paseo plugin add npm:@stevecastaneda/paseo-workspace-links
```

From Paseo's plugin registry: `paseo plugin add stevecastaneda/workspace-links`.

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

Use fixed URLs or have your existing setup/dev script generate this same file with the workspace's current URLs. Gitignore it if it contains workspace-specific values. The Links popover rereads the file on its own. Click **Refresh** in the panel if that list still looks stale. The plugin does not execute scripts.

Links open on the **device you're using**, the same way Paseo opens its own links: your default browser in the desktop app, a new tab in the web app, or the phone's browser in the mobile app.

`localhost` therefore refers to that device. When the daemon runs on another machine, or you use Paseo from your phone, `localhost` links reach the daemon's dev server only if that port is forwarded to your device.

The status dots are checked from the machine running Paseo, so a `localhost` link can show as running even when it won't open on your phone.

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

The package manifest is required for the Paseo plugin's SDK and development types. Paseo's npm install fetches `@getpaseo/client`, whose types the plugin imports. Nothing from it runs in the plugin.

## Updates

Workspace and agent changes arrive through subscriptions rather than repeated
list requests. Links controls refresh their list every two seconds while
displayed. **Refresh** in the panel also updates the list immediately.

Placement changes apply immediately in the current client. Other connected
clients pick up saved options when they next load the options or reload the
plugin.

## Changelog

### 0.5.1

- Installs again with npm 12. Installing failed with `npm ci` asking for a `package-lock.json`, because npm 12 no longer reads the lockfile this plugin shipped ([#53](https://github.com/stevecastaneda/paseo-plugins/issues/53)). The plugin no longer runs its own install step; Paseo's npm install already brings in what it needs.
- Install from npm or Paseo's plugin registry. Installing straight from GitHub no longer works.

### 0.5.0

- The Links popover shows each link's URL under its name. Long URLs are shortened in the middle.
- Each link gets an icon picked from its name or URL: docs, admin, auth, database, storage, API and more.
- A green dot shows which links are running. Paseo checks them every few seconds while the popover is open. A hollow dot means nothing answered.
- Hover a link to copy its URL.
- A friendlier empty state with an **Add links** button.
