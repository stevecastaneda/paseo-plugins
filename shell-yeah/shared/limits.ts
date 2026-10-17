// Every cap the plugin applies, in one place. A "bytes" limit is measured as the
// UTF-8 bytes of the JSON that crosses the wire, which is what Paseo measures.
export const LIMITS = {
  commandChars: 8_000,
  commandBytes: 16 * 1024,
  maxLive: 8,
  keepFinished: 30,
  linesKept: 10_000,
  lineChars: 4_000,
  captureBytes: 128 * 1024 * 1024,
  // Half of Paseo's 64 KiB row cap: every later agent.turn_ended hook gets a
  // structured clone of the whole timeline, so fat rows are paid for on every turn.
  rowOutputBytes: 32 * 1024,
  rowTotalBytes: 60 * 1024,
  liveReplyBytes: 128 * 1024,
  peekLines: 8,
  // A failure's cause usually sits a few lines above the summary at the bottom.
  failedPeekLines: 14,
  peekFetchLines: 16,
  // Past this, the one-line header may cut the command off, so the card unfolds to show it whole.
  headerCommandChars: 80,
  expandedLines: 300,
  proposalsPerReply: 4,
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
  report: { maxLines: 300, headLines: 20, maxChars: 24_000, lineClamp: 2_000 },
  uiStoreEntries: 50,
  pollBackoffMs: [500, 1_000, 2_000, 4_000] as readonly number[],
};

export type Limits = Readonly<typeof LIMITS>;
