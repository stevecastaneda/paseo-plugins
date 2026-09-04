import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatElapsed,
  formatTimeSinceLabel,
  isWorkingStatus,
  lastThreadMessageAt,
  lastThreadMessageAtFromStream,
} from "./elapsed.ts";

test("formatElapsed clamps negatives and reports seconds under a minute", () => {
  assert.equal(formatElapsed(-50), "0s");
  assert.equal(formatElapsed(0), "0s");
  assert.equal(formatElapsed(12_000), "12s");
  assert.equal(formatElapsed(59_999), "59s");
});

test("formatElapsed uses minutes, then hours, then days", () => {
  assert.equal(formatElapsed(60_000), "1m");
  assert.equal(formatElapsed(90_000), "1m 30s");
  assert.equal(formatElapsed(4 * 60_000 + 59_000), "4m 59s");
  assert.equal(formatElapsed(5 * 60_000), "5m");
  assert.equal(formatElapsed(5 * 60_000 + 30_000), "5m");
  assert.equal(formatElapsed(12 * 60_000 + 45_000), "12m");
  assert.equal(formatElapsed(3_600_000), "1h");
  assert.equal(formatElapsed(3_660_000), "1h 1m");
  assert.equal(formatElapsed(86_400_000), "1d");
  assert.equal(formatElapsed(90_000_000), "1d 1h");
});

test("formatTimeSinceLabel returns elapsed time without a suffix", () => {
  const at = "2026-09-04T12:00:00.000Z";
  const now = Date.parse(at) + 125_000;
  assert.equal(formatTimeSinceLabel(at, now), "2m 5s");
  assert.equal(formatTimeSinceLabel("not-a-date", now), null);
});

test("isWorkingStatus hides the pill during a live turn", () => {
  assert.equal(isWorkingStatus("running"), true);
  assert.equal(isWorkingStatus("initializing"), true);
  assert.equal(isWorkingStatus("idle"), false);
  assert.equal(isWorkingStatus("error"), false);
  assert.equal(isWorkingStatus("closed"), false);
});

test("lastThreadMessageAt prefers the newest user or assistant row", () => {
  const older = "2026-09-04T12:00:00.000Z";
  const user = "2026-09-04T12:10:00.000Z";
  const assistant = "2026-09-04T12:12:00.000Z";
  const tool = "2026-09-04T12:13:00.000Z";
  assert.equal(
    lastThreadMessageAt([
      { timestamp: older, item: { type: "user_message" } },
      { timestamp: user, item: { type: "user_message" } },
      { timestamp: assistant, item: { type: "assistant_message" } },
      { timestamp: tool, item: { type: "tool_call" } },
    ]),
    assistant,
  );
});

test("lastThreadMessageAt falls back to the newest timeline row when no chat messages exist", () => {
  assert.equal(lastThreadMessageAt([]), null);
  assert.equal(
    lastThreadMessageAt([{ timestamp: "nope", item: { type: "user_message" } }]),
    null,
  );
  assert.equal(
    lastThreadMessageAt([
      { timestamp: "2026-09-04T12:00:00.000Z", item: { type: "tool_call" } },
      { timestamp: "2026-09-04T12:05:00.000Z", item: { type: "reasoning" } },
    ]),
    "2026-09-04T12:05:00.000Z",
  );
});

test("lastThreadMessageAtFromStream only accepts chat message timeline events", () => {
  const at = "2026-09-04T12:12:00.000Z";
  assert.equal(
    lastThreadMessageAtFromStream({
      timestamp: at,
      event: { type: "timeline", item: { type: "assistant_message" } },
    }),
    at,
  );
  assert.equal(
    lastThreadMessageAtFromStream({
      timestamp: at,
      event: { type: "timeline", item: { type: "tool_call" } },
    }),
    null,
  );
  assert.equal(
    lastThreadMessageAtFromStream({
      timestamp: at,
      event: { type: "turn_completed" },
    }),
    null,
  );
});
