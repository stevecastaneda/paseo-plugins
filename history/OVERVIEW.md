History adds a History pill to the message composer. It opens the session log that Codex, Claude Code or OpenCode saved for the chat, which can differ from what Paseo shows. Needs Paseo 0.9 or later.

The Conversation view groups the log into turns and shows your messages and the agent's replies. Tags under each turn open its tool calls, reasoning, context and other events, and Raw shows every record in the turn. The Source view lists the original records and the log's file path. You can copy any message as Markdown, or copy its raw JSON.

The window reads the log from the start, one batch at a time. Press More for the next batch, or Refresh to read it again after the chat moves on. It doesn't update by itself, and there's no search.

The plugin reads these logs on the computer running the Paseo daemon and never changes them:

- Codex logs come from `CODEX_HOME`, `~/.codex` by default, and include archived sessions.
- Claude Code logs come from `CLAUDE_CONFIG_DIR`, `~/.claude` by default.
- OpenCode history comes from running `opencode export --pure`, so `opencode` must be on the daemon's `PATH`.

The plugin makes no network requests of its own. Images in messages show as labeled links instead of loading. Chats from other providers still get the pill, but the window only says their history isn't supported yet.
