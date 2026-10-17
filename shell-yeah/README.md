<img src="https://raw.githubusercontent.com/stevecastaneda/paseo-plugins/main/shell-yeah/icon.png" alt="" width="64" height="64">

# Shell Yeah

A plugin for Paseo 0.11 and later. Type `/sh` and a command in the message box to run it yourself, in the agent's folder, with live output in the chat. The agent sees the output only if you send it.

It's the Paseo version of Claude Code's `!` mode. It's also how an agent hands you a command it can't run itself: a login that needs your browser, a deploy behind your VPN, a publish that needs your 2FA code. The command shows up under the agent's reply with a **Run** button.

## Running a command

Type `/sh npm test` and press Enter. A card appears in the chat:

- While the command runs: a spinner, a timer, the last lines of output as they arrive, and **Stop**. Progress bars and spinners redraw in place, the way they do in a terminal.
- When it ends: **Done** or **Exit 1** with how long it took, the colored output, and **Send to Claude**, **Copy** and **Rerun**. Buttons and notes name the chat's agent, so a Codex chat says **Send to Codex**.

The card shows the last 8 lines, or the last 14 when the command failed, skipping blank lines at either end. Press the arrow in the header to see up to 300. **Copy** copies everything the plugin kept, up to 10,000 lines.

The command runs on the Paseo host as the user Paseo runs as, in the agent's working folder, with your shell (`$SHELL -c`). It has no keyboard, so a command that asks for a password or a confirmation stops and waits; the card tells you when that seems to be happening. It skips interactive startup files like `.zshrc`, so aliases aren't loaded. Your PATH carries over.

A leading `! ` or `$ ` is dropped, so you can paste a command straight from a README.

## Sending output to the agent

Nothing reaches the agent until you press **Send to Claude**. The chat then shows one line, like ``Output of `npm test` (exit 1, 2.9 s, 29 lines)``, and the agent receives the command and its output, cut to the first 20 and last 280 lines when it's long. If the agent is in the middle of a turn, the output joins that turn instead of interrupting it. If the agent is waiting for you to approve something, the plugin asks you to answer that first.

The footer says where things stand: **Claude can't see this** before you send, and **Sent to Claude 10:42** after.

You can also attach a command's output to your next message: open the attach menu in the message box and pick it under **Command output**.

## Commands from the agent

Agents created after you install the plugin learn one rule: when they want you to run something, they put it alone in a fenced block marked `sh run`:

````markdown
```sh run
npm run deploy:staging
```
````

When the reply ends, the plugin adds a card under it with the command, **Suggested by Claude**, and **Run**, **Copy** and **Dismiss**. Nothing runs until you press **Run**. Without the plugin, the block is an ordinary shell code block.

Agents that started before the plugin was installed don't know the rule. Type `/sh` on its own and the plugin looks through the last reply for any shell code block and offers each one, up to four.

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

- First version: `/sh` with live output, Send to Claude, attach as `@` context, and Run cards for commands the agent hands you.
