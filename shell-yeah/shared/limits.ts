// Every cap the plugin applies, in one place. A "bytes" limit is measured as the
// UTF-8 bytes of the JSON that crosses the wire, which is what Paseo measures.
export const LIMITS = {
  commandChars: 8_000,
  commandBytes: 16 * 1024,
  // Keys in one send. A longer paste goes in pieces.
  inputChars: 4_000,
  maxLive: 8,
  keepFinished: 30,
  linesKept: 10_000,
  lineChars: 4_000,
  captureBytes: 128 * 1024 * 1024,
  // Half of Paseo's 64 KiB row cap: every later agent.turn_ended hook gets a
  // structured clone of the whole timeline, so fat rows are paid for on every turn.
  rowOutputBytes: 32 * 1024,
  rowTotalBytes: 60 * 1024,
  pastRuns: 10,
  pastRunOutputBytes: 3 * 1024,
  liveReplyBytes: 128 * 1024,
  // The output box's height in lines; a failure's cause usually sits a few lines above
  // its summary. The header arrow makes the box taller, short of a phone screen.
  boxLines: 12,
  failedBoxLines: 14,
  tallBoxLines: 21,
  // Past this, the one-line header may cut the command off, so the card unfolds to show it whole.
  headerCommandChars: 80,
  // Lines a card can scroll back through, live and in its row; Copy gets everything kept.
  scrollbackLines: 300,
  proposalsPerReply: 4,
  suggestionsPerReply: 8,
  tailCoalesceMs: 60,
  tailWaitMs: 1_500,
  tailWaitMaxMs: 2_000,
  stopToTermMs: 5_000,
  stopToKillMs: 10_000,
  forceStopAfterMs: 3_000,
  exitFlushMs: 500,
  shutdownPublishMs: 1_000,
  shutdownKillWaitMs: 400,
  publishRetryMs: [1_000, 5_000, 30_000] as readonly number[],
  quietNoteMs: 10_000,
  inputHintMs: 8_000,
  // What Send and attach give the agent. Output this small goes whole. Longer output goes as a
  // summary (first lines, error-looking lines, last lines) plus the full log saved to a file.
  report: { inlineLines: 200, inlineChars: 16_000, lineClamp: 2_000, headLines: 10, tailLines: 60, tailChars: 12_000, errorLines: 30, summaryLineChars: 500 },
  // A saved log goes when its chat is archived, after a week, or oldest first past the size cap.
  logs: { maxAgeMs: 7 * 24 * 60 * 60 * 1000, maxBytes: 100 * 1024 * 1024 },
  uiStoreEntries: 50,
  pollBackoffMs: [500, 1_000, 2_000, 4_000] as readonly number[],
};

export type Limits = Readonly<typeof LIMITS>;
