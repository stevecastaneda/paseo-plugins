# Contributing

How to work on these plugins and release them. For what each plugin does and how to install it, see the [README](README.md).

## Local development

Paseo runs each plugin from one folder on your machine. `npm run dev` makes Paseo run the plugin from the folder you're in. You need Node.js 22.18 or later.

**1. Point Paseo at your copy.** From the plugin's folder in your checkout or worktree:

```bash
cd time-since   # or setup-monitor, workspace-links, history, progress, or playwright-pulse
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

Each plugin versions itself in that directory's `package.json`. npm and the Paseo plugin store use that field to tell releases apart, so bump it whenever you ship a change to that plugin. Sibling plugins and the git tag on this repository do not count.

Versions follow [semver](https://semver.org). Each plugin moves from 0.x to `1.0.0` at its next release. From then on:

| The change | Bump | Example |
| --- | --- | --- |
| Breaks something for people already using the plugin: drops a Paseo version, removes a feature or setting, moves saved data | First number | `1.4.2` to `2.0.0` |
| Adds a feature | Middle number | `1.4.2` to `1.5.0` |
| Fixes a bug, or changes only the README or store page | Last number | `1.4.2` to `1.4.3` |

A change that never reaches users, such as dev dependencies, tests or lockfiles, needs no bump.

Do not cut a GitHub Release for the whole repo. To release a plugin, bump the version in its `package.json` and `package-lock.json` and run `npm run check:install` in its folder. Merge to `main`, then run `npm publish` in that folder. The store's update bot checks npm twice a day and opens an update for a store maintainer to review.

`check:install` packs the plugin and installs it the way Paseo installs from npm, once with your npm and once with the latest npm. The manifests have no `build` step because Paseo's npm install already brings in each plugin's dependencies. `paseo plugin update` installs the newest version on npm. A plugin installed from Git gets the newest commit on its branch instead.
