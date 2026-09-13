# History

A **History** composer pill with Paseo’s built-in Gallery Vertical End icon opens a dialog for inspecting a chat's saved history.

The default **Conversation** view groups saved records into turns and displays user and assistant messages. Tags reveal tools, reasoning, context, and other events. Each message has **Copy message** and an expandable **Raw** view with **Copy JSON**. **Raw source** shows the original JSONL records and their file path.

Messages render Markdown, including headings, emphasis, lists, links, and tables. Code blocks scroll horizontally and have a **Copy code** action. **Copy message** keeps the original Markdown. Internal citation metadata is hidden in the readable view and preserved in Raw; HTML stays plain text. Web links open normally, while local file links copy their destination. Images appear as labeled links rather than loading remote files.

The dialog automatically reads past introductory context to show conversation messages. Use **Load more** to continue through the history. Related records merge into their turn as they load. **Refresh** rereads from the beginning. The last loaded turn may have more records until the file is fully loaded. Files are never rewritten.

Supports **Codex** and **Claude Code**. Logs are read on the Paseo daemon host using the chat's native session ID. Codex uses `CODEX_HOME` (default `~/.codex`), including archived sessions. Claude uses `CLAUDE_CONFIG_DIR` (default `~/.claude`). Unsupported providers and missing or ambiguous files show an explanation. A single entry larger than 4 MiB must be inspected in an editor.

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
