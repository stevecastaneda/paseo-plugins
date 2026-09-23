import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatElapsed,
  formatTimeSinceLabel,
  formatTimeSincePillLabel,
  isWorkingStatus,
  lastThreadMessageAtFromStream,
} from "../shared/elapsed.ts";

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

test("formatTimeSincePillLabel adds the ago suffix and falls back to an ellipsis", () => {
  const at = "2026-09-04T12:00:00.000Z";
  const now = Date.parse(at) + 125_000;
  assert.equal(formatTimeSincePillLabel(at, now, false), "2m 5s");
  assert.equal(formatTimeSincePillLabel(at, now, true), "2m 5s ago");
  assert.equal(formatTimeSincePillLabel(null, now, true), "…");
  assert.equal(formatTimeSincePillLabel("not-a-date", now, false), "…");
});

test("isWorkingStatus hides the pill during a live turn", () => {
  assert.equal(isWorkingStatus("running"), true);
  assert.equal(isWorkingStatus("initializing"), true);
  assert.equal(isWorkingStatus("idle"), false);
  assert.equal(isWorkingStatus("error"), false);
  assert.equal(isWorkingStatus("closed"), false);
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
