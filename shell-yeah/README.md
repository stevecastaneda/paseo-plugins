<img src="https://raw.githubusercontent.com/stevecastaneda/paseo-plugins/main/shell-yeah/icon.png" alt="" width="64" height="64">

# Shell Yeah

A plugin for Paseo 0.11 and later. Type `/sh` and a command in the message box to run it yourself, in the agent's folder, with live output in the chat. The agent sees the output only if you send it.

It's the Paseo version of Claude Code's `!` mode. It's also how an agent hands you a command it can't run itself: a login that needs your browser, a deploy behind your VPN, a publish that needs your 2FA code. The command shows up under the agent's reply with a **Run** button.

## Running a command

Type `/sh npm test` and press Enter. A card appears in the chat:

- While the command runs: a spinner, a timer, the last lines of output as they arrive, and **Stop**. Progress bars and spinners redraw in place, the way they do in a terminal.
- When it ends: **Done** or **Exit 1** with how long it took, the colored output, and **Send**, **Copy** and **Rerun**. Buttons and notes name the chat's agent: **Send to Claude** in a Claude chat, **Send to Codex** in a Codex chat.

The output box holds the last 300 lines and stays on the newest one while the command runs. Scroll up for earlier lines; **Jump to latest** brings you back. The arrow in the header makes the box taller. **Copy** copies everything the plugin kept, up to 10,000 lines.

The command runs on the Paseo host as the user Paseo runs as, in the agent's working folder, with your shell (`$SHELL -c`). It has no keyboard, so a command that asks for a password or a confirmation stops and waits; the card tells you when that seems to be happening. It skips interactive startup files like `.zshrc`, so aliases aren't loaded. Your PATH carries over.

A leading `! ` or `$ ` is dropped, so you can paste a command straight from a README.

## Sending output to the agent

Nothing reaches the agent until you press **Send**. The chat then shows one line, like ``Output of `npm test` (exit 1, 2.9s) · all 29 lines attached``. The agent gets the command and its output as an attachment, which Paseo doesn't display, so that line says what went along. If the agent is in the middle of a turn, the output joins that turn instead of interrupting it. If the agent is waiting for you to approve something, the plugin asks you to answer that first.

Output of up to 200 lines goes whole. Longer output goes as a summary: the first 10 lines, the last 60, and the lines that look like errors, with their line numbers. The plugin saves the full log to a file and gives the agent its path, so the agent can read or search the rest itself. The chat line then says ``summary attached, full 12,408-line log saved for the agent``.

Saved logs go in `~/.local/state/shell-yeah/logs`, one folder per chat, never in your project. They clean up on their own. Archiving a chat deletes its logs, and archiving a workspace archives its chats. Any log older than a week is deleted, and past 100 MB the oldest logs go first.

The footer says where things stand: **Claude can't see this** before you send, and **Sent to Claude 10:42** after.

You can also attach a command's output to your next message: open the attach menu in the message box and pick it under **Command output**.

## Commands from the agent

Agents created after you install the plugin learn one rule: when they want you to run something, they put it alone in a fenced block marked `sh run`, under a one-line comment that says in plain words what it does:

````markdown
```sh run
# Deploy the coupon fix to staging
npm run deploy:staging
```
````

When the reply ends, the plugin adds a card under it: the agent's comment as the title, the command, **Suggested by Claude**, and **Run**, **Copy** and **Dismiss**. Nothing runs until you press **Run**. The shell skips the comment line, and **Copy** leaves it out. Without the plugin, the block is an ordinary shell code block.

The card also warns you, in amber, when the command is hard to undo: when it runs as administrator (`sudo`), deletes files, throws away uncommitted changes, force-pushes, or runs a script downloaded from the internet. The plugin spots these by itself, so the warning shows even when the agent didn't mention it. It catches the common forms, not every disguise, so still read the command.

Agents that started before the plugin was installed don't know the rule. Type `/sh` on its own and the plugin looks through the last reply for any shell code block and offers each one, up to four.

## Agents

`/sh`, **Copy** and **Rerun** work in any chat, because the plugin runs the command, not the agent. **Send** has been tested with Claude.

Run cards need the agent to know the `sh run` rule. Paseo passes it to new Claude, Codex, OpenCode, Pi and Oh My Pi chats. Agents Paseo runs over ACP, such as Copilot and Cursor, don't get it; type `/sh` on its own to turn the shell blocks in their last reply into Run cards.

## Limits

- No keyboard input. Use a terminal tab for anything interactive.
- Up to 8 commands run at once across all chats. The plugin keeps the last 30 finished ones for **Copy** and **Send**; older cards fall back to the lines they show.
- Paseo only treats `/sh` as a command when the message box has no attachments. With an attachment, `/sh npm test` goes to the agent as text.
- Cards show live output only while the plugin is running. After Paseo restarts, a card that was still running says **Interrupted**, and finished cards keep the lines they ended with.
- macOS and Linux only.

## Install

```sh
paseo plugin add npm:@stevecastaneda/paseo-shell-yeah
```

Enable plugins under **Settings → Plugins** on the Paseo host. You need Node.js 22.18 or later on the daemon host.

## Changelog

### 0.1.0

- First version: `/sh` with live output, sending output to the agent, attaching it to a message, and Run cards for commands the agent hands you. Long output goes to the agent as a summary plus a saved log it can search, and saved logs clean up on their own. Cards for suggested commands carry the agent's plain-words title and warn about commands that are hard to undo.
