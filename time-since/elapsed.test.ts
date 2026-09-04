import assert from "node:assert/strict";
import { test } from "node:test";
import { formatElapsed, formatTimeSinceLabel } from "./elapsed.ts";

test("formatElapsed clamps negatives and reports seconds under a minute", () => {
  assert.equal(formatElapsed(-50), "0s");
  assert.equal(formatElapsed(0), "0s");
  assert.equal(formatElapsed(12_000), "12s");
  assert.equal(formatElapsed(59_999), "59s");
});

test("formatElapsed uses minutes, then hours, then days", () => {
  assert.equal(formatElapsed(60_000), "1m");
  assert.equal(formatElapsed(90_000), "1m 30s");
  assert.equal(formatElapsed(3_600_000), "1h");
  assert.equal(formatElapsed(3_660_000), "1h 1m");
  assert.equal(formatElapsed(86_400_000), "1d");
  assert.equal(formatElapsed(90_000_000), "1d 1h");
});

test("formatTimeSinceLabel distinguishes a live turn from idle age", () => {
  const at = "2026-09-04T12:00:00.000Z";
  const now = Date.parse(at) + 125_000;
  assert.equal(formatTimeSinceLabel(at, "running", now), "working 2m 5s");
  assert.equal(formatTimeSinceLabel(at, "idle", now), "2m 5s ago");
  assert.equal(formatTimeSinceLabel("not-a-date", "idle", now), null);
});
