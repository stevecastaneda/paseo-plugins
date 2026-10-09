Time Since adds a clock above the message box that counts up from the last message in the chat, yours or the agent's. It hides while the agent works. When it shows, it tells you how long the agent has been waiting on you. Needs Paseo 0.9 or later.

It reads `4m 12s` for the first five minutes, then drops the seconds: `12m`, `4h 12m`, `2d 3h`. Click it to see the exact date and time of the last message.

The plugin records on the daemon when each agent's turn ends, so after you close and reopen Paseo the clock still counts from the last reply. For turns that ended before you installed the plugin, it falls back to your last message, then to when the agent was created. Those readings run long, never short.

Time Since Options in the Command Center lets you hide the clock icon or add "ago" after the time, with a preview of the result. The options apply to every workspace on the connected host. The plugin saves them, along with the reply times, in the Paseo home on the daemon host.
