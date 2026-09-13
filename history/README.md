# History

A **History** composer pill with Paseo’s built-in Gallery Vertical End icon opens a dialog for inspecting a chat's saved history.

The default **Conversation** view groups saved records into turns and displays user and assistant messages. Use the footer’s up/down arrows to scroll to the previous or next loaded turn. Tags reveal tools, reasoning, context, and other events. Each message has **Copy message** and an expandable **Raw** view with **Copy JSON**. **Raw source** shows the original JSONL records and their file path.

Messages render Markdown, including headings, emphasis, lists, links, and tables. Code blocks scroll horizontally and have a **Copy code** action. **Copy message** keeps the original Markdown. Internal citation metadata is hidden in the readable view and preserved in Raw; HTML stays plain text. Web links open normally, while local file links copy their destination. Images appear as labeled links rather than loading remote files.

Recognized task notifications show their status, summary, and Markdown result immediately, with token/tool/duration statistics when available. **Details** reveals task IDs, output paths, and notes; **Copy task result** copies just the result. Original notifications remain in Raw. Unknown or incomplete wrappers stay as ordinary message text.

The dialog automatically reads past introductory context to show conversation messages. Use **More** to continue through the history. Related records merge into their turn as they load. **Refresh** rereads from the beginning. The last loaded turn may have more records until the file is fully loaded. Files are never rewritten.

Supports **Codex**, **Claude Code**, and **OpenCode**. History is read on the Paseo daemon host using the chat's native session ID. Codex uses `CODEX_HOME` (default `~/.codex`), including archived sessions. Claude uses `CLAUDE_CONFIG_DIR` (default `~/.claude`). Unsupported providers and missing or ambiguous files show an explanation. A single entry larger than 4 MiB must be inspected externally.

OpenCode uses its [session export command](https://opencode.ai/docs/cli/#export), with external plugins disabled (`--pure`). It requires an OpenCode version supporting that flag on the daemon's `PATH` (verified with 1.18.18), and inherits the daemon's OpenCode/XDG environment. Raw source shows the export command and JSONL-formatted session metadata and complete message records, preserving their parts and metadata. Export requests are limited to 64 MiB and 30 seconds. Each page checks the exported content; if the session changes while paging, use **Refresh** to reread it. Text, file labels, tool inputs/results/errors, and reasoning are recognized; unknown parts remain in Raw.

The viewer shows what the harness saved, which can differ from Paseo's displayed chat. Tool results and mirrored transport events stay behind tags rather than appearing as additional conversation messages.

## Local install

With plugins enabled in Paseo:

```sh
cd history
npm install
npm run typecheck
npm test
paseo plugin install "$PWD"
```

After edits, run the checks and `paseo plugin reload history`.
