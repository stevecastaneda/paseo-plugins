# Threat model

Every plugin in this repo is reviewed against this model before it's published. It also sets the bar for what blocks a release.

## Who the attacker is

People open repos they didn't write: a clone of a stranger's project, a pull request branch, a downloaded sample. Agents read those repos and can be steered by what they read. So the attacker controls:

- **The repo's committed content.** Files, folder names, symlinks, submodules, `.gitignore`, `.gitattributes`, and files left by older plugin versions.
- **What an agent writes.** Messages, tool calls, plugin commands and their arguments. Treat any text an agent produces as possibly written by the repo it read.
- **Web pages and files a plugin loads or shows.** HTML reports, Markdown, images, links.

The attacker does not control:

- the user's own settings, git config and environment variables,
- what the user types themselves, or
- other programs running on the user's machine at the same time.

The user's normal clicks in a plugin's UI are in scope. A plugin that does something dangerous on one click is a finding, unless the click shows exactly what will happen first.

## What must never happen

Using only what the attacker controls, a plugin must never:

1. **Run code the user didn't choose.** This includes a program found in the repo folder (Windows looks there first), a script opened with the system's default app, or a command hidden behind a harmless label.
2. **Write, empty, append to, rename over, or delete a file outside the plugin's own folders,** or anything inside a `.git` folder. Links, `..` paths, case variants on macOS and Windows, and submodules are the usual ways in.
3. **Send the user's private files anywhere.** That covers files git ignores (like `.env`), `.git` contents, and files outside the worktree. A preview that runs scripts must not be handed them.
4. **Put attacker content where the user trusts it,** like the plugin's own panel, settings, or history, so it looks like the user's own work.
5. **Freeze or crash the plugin server** for every workspace on the host.

Items 1 to 4 block a release. Item 5 is a follow-up unless it's permanent.

## How a review works

A reviewer who didn't write the change reads the plugin's server code, client code, and anything that touches files, programs, HTML, or the network. For each finding, the reviewer gives:

- the file and line,
- the exact content or agent output that triggers it,
- the steps and the harm, and
- whether they ran it or reasoned it from the source.

Only findings that break items 1 to 4 block the release. Hardening ideas, timing races between programs, and problems that need the user's own settings go in the plugin's follow-up list.

When one feature keeps producing findings, remove the feature instead of adding another check.
