import assert from "node:assert/strict";
import { test } from "node:test";
import type { Line, Phase } from "./row.ts";
import { describe, formatDuration, statusText, type ResolvedRun } from "./view.ts";

const T0 = 1_700_000_000_000;

function run(phase: Phase, overrides: Partial<ResolvedRun> = {}): ResolvedRun {
  return { runId: "r1", origin: "user", command: "npm test", cwd: "/repo", rev: 1, phase, output: { lines: ["a", "b"], total: 2 }, sentAt: null, lostAt: null, lastOutputAt: null, clockOffset: 0, ...overrides };
}

const ended = { startedAt: T0, endedAt: T0 + 12_400 };
const ids = (p: ReturnType<typeof describe>) => p.actions.map((a) => a.id);
const primary = (p: ReturnType<typeof describe>) => p.actions.find((a) => a.primary)?.id ?? null;

test("a proposal is a dashed card with Run filled, plus Copy and Dismiss", () => {
  const p = describe(run({ kind: "proposed" }, { origin: "claude", output: { lines: [], total: 0 } }), T0, { agent: "Codex" });
  assert.equal(p.layout, "proposed");
  assert.equal(p.badge, "play");
  assert.deepEqual(ids(p), ["run", "copy", "dismiss"]);
  assert.equal(primary(p), "run");
  assert.equal(p.well, null);
  assert.equal(p.label, "Suggested by Codex");
  assert.deepEqual(p.notes, [{ icon: "eye-off", text: "Codex sees the output only if you send it" }, { icon: "folder", text: "repo" }]);
  assert.match(describe(run({ kind: "proposed" }, { origin: "claude" }), T0).notes[0].text, /^The agent sees/);
});

test("a suggestion shows the agent's title over the command, and warns when the command is hard to undo", () => {
  const titled = describe(run({ kind: "proposed" }, { origin: "claude", command: "# Clean the build folder\nsudo rm -rf dist", output: { lines: [], total: 0 } }), T0);
  assert.equal(titled.title, "Clean the build folder");
  assert.equal(titled.script, "sudo rm -rf dist");
  assert.equal(titled.warning, "Runs as administrator (sudo) and deletes files");
  const plain = describe(run({ kind: "proposed" }, { origin: "claude", command: "gh auth login --web", output: { lines: [], total: 0 } }), T0);
  assert.deepEqual([plain.title, plain.script, plain.warning], [null, "gh auth login --web", null]);
  const three = describe(run({ kind: "proposed" }, { origin: "claude", command: "sudo rm -rf x && git push -f", output: { lines: [], total: 0 } }), T0);
  assert.equal(three.warning, "Runs as administrator (sudo), deletes files and force-pushes");
  // Once it runs, the card is a receipt: the command without its title, and no warning.
  const ran = describe(run({ kind: "ok", ...ended }, { origin: "claude", command: "# Clean the build folder\nsudo rm -rf dist" }), T0);
  assert.deepEqual([ran.title, ran.script, ran.warning, ran.foldable], [null, "sudo rm -rf dist", null, false]);
});

test("a running row shows a ticking timer, a line count, and Stop", () => {
  const p = describe(run({ kind: "running", startedAt: T0, stopRequestedAt: null }, { output: { lines: ["x"], total: 214 }, lastOutputAt: T0 + 5_000 }), T0 + 6_000);
  assert.equal(p.tone, "active");
  assert.equal(p.badge, "spinner");
  assert.equal(p.label, "");
  assert.equal(p.timerFrom, T0);
  assert.equal(primary(p), "stop");
  assert.deepEqual(p.notes, [{ icon: "clock", text: "214 lines" }]);
  assert.deepEqual(p.well, { kind: "output", skipped: 213 });
  // Quiet for ten seconds: the note says so.
  assert.equal(describe(run({ kind: "running", startedAt: T0, stopRequestedAt: null }, { output: { lines: ["x"], total: 214 }, lastOutputAt: T0 }), T0 + 12_000).notes[0].text, "214 lines · quiet for 12s");
  // A skewed client clock is corrected for the timer and the quiet note.
  const skewed = describe(run({ kind: "running", startedAt: T0, stopRequestedAt: null }, { clockOffset: 300_000, lastOutputAt: T0 }), T0 - 300_000 + 1_000);
  assert.equal(skewed.timerFrom, T0 - 300_000);
  assert.equal(skewed.notes[0].text, "2 lines");
});

test("stop requested: Stopping is disabled for three seconds, then Force stop takes over", () => {
  const phase: Phase = { kind: "running", startedAt: T0, stopRequestedAt: T0 + 10_000 };
  const stopping = describe(run(phase), T0 + 11_000);
  assert.equal(stopping.label, "Stopping");
  assert.deepEqual(stopping.actions, [{ id: "stop", label: "Stopping…", primary: true, disabled: true }]);
  const force = describe(run(phase), T0 + 13_000);
  assert.deepEqual(ids(force), ["force-stop"]);
  assert.equal(primary(force), "force-stop");
});

test("each ended state has its own label, tone and badge", () => {
  const cases: Array<[Phase, string, string, string]> = [
    [{ kind: "ok", ...ended }, "Done · 12s", "success", "check"],
    [{ kind: "failed", ...ended, exitCode: 1, signal: null, message: null }, "Exit 1 · 12s", "danger", "x"],
    [{ kind: "failed", ...ended, exitCode: null, signal: "SIGKILL", message: null }, "Killed (SIGKILL) · 12s", "danger", "x"],
    [{ kind: "stopped", ...ended, exitCode: 130, signal: null }, "Stopped · 12s", "warning", "square"],
    [{ kind: "interrupted", ...ended }, "Interrupted · 12s", "warning", "unplug"],
  ];
  for (const [phase, status, tone, badge] of cases) {
    const p = describe(run(phase), T0 + 20_000);
    assert.equal(statusText(p), status);
    assert.equal(p.tone, tone);
    assert.equal(p.badge, badge);
    assert.equal(p.layout, "card");
  }
  const interrupted = describe(run({ kind: "interrupted", ...ended }), T0);
  assert.ok(interrupted.notes.some((n) => n.text === "Stopped when the plugin restarted"));
});

test("a command that never started shows the reason as the well and no duration", () => {
  const p = describe(run({ kind: "failed", ...ended, exitCode: null, signal: null, message: "Folder not found: /gone" }, { output: { lines: [], total: 0 } }), T0);
  assert.equal(statusText(p), "Couldn't start");
  assert.deepEqual(p.well, { kind: "message", text: "Folder not found: /gone" });
});

test("Send to Claude is filled for a Claude-suggested run and for a failure, quiet otherwise", () => {
  const ok = describe(run({ kind: "ok", ...ended }), T0, { agent: "Claude" });
  assert.deepEqual(ids(ok), ["copy", "rerun", "send"]);
  assert.equal(ok.actions[2].label, "Send to Claude");
  assert.equal(describe(run({ kind: "ok", ...ended }), T0).actions[2].label, "Send to the agent");
  assert.equal(primary(ok), null);
  const claudes = describe(run({ kind: "ok", ...ended }, { origin: "claude" }), T0);
  assert.deepEqual(ids(claudes), ["send", "copy", "rerun"]);
  assert.equal(primary(claudes), "send");
  const failed = describe(run({ kind: "failed", ...ended, exitCode: 1, signal: null, message: null }), T0);
  assert.equal(primary(failed), "send");
  // Once sent, nothing is primary and the button offers to send again.
  const sent = describe(run({ kind: "ok", ...ended }, { origin: "claude", sentAt: T0 + 60_000 }), T0, { agent: "Claude" });
  assert.equal(primary(sent), null);
  assert.equal(sent.actions.find((a) => a.id === "send")?.label, "Send again");
  assert.equal(sent.notes[0].icon, "eye");
  assert.match(sent.notes[0].text, /^Sent to Claude \d{1,2}:\d{2}$/);
  assert.deepEqual(ok.notes[0], { icon: "eye-off", text: "Claude can't see this" });
});

test("truncated output gets a scissors note; empty output gets no well", () => {
  const cut = { output: { lines: Array(412).fill("x"), total: 12_408 } };
  assert.deepEqual(describe(run({ kind: "ok", ...ended }, cut), T0).notes[1], { icon: "scissors", text: "Last 412 of 12,408 lines" });
  assert.equal(describe(run({ kind: "ok", ...ended }, { output: { lines: Array(60).fill("x"), total: 60 } }), T0).notes.length, 1, "every line is in the box, so nothing is called hidden");
  const collapsed = describe(run({ kind: "ok", ...ended }, cut), T0);
  assert.deepEqual(collapsed.well, { kind: "output", skipped: 11_996 });
  assert.equal(collapsed.foldable, true);
  const padded = describe(run({ kind: "ok", ...ended }, { output: { lines: ["", ...Array(8).fill("x"), ""], total: 10 } }), T0);
  assert.equal(padded.notes.length, 1);
  assert.equal(padded.foldable, false, "blank lines at either end don't count toward the box height");
  const tall = describe(run({ kind: "ok", ...ended }, { output: { lines: Array(13).fill("x"), total: 13 } }), T0);
  assert.equal(tall.foldable, true, "past 12 lines the header arrow can make the box taller");
  assert.equal(tall.boxLines, 12);
  const failed = describe(run({ kind: "failed", ...ended, exitCode: 1, signal: null, message: null }, { output: { lines: Array(13).fill("x"), total: 13 } }), T0);
  assert.equal(failed.boxLines, 14, "a failure's box is taller, so its cause stays in view");
  assert.equal(failed.foldable, false);
  const empty = describe(run({ kind: "ok", ...ended }, { output: { lines: [], total: 0 } }), T0);
  assert.deepEqual(empty.well, { kind: "empty", text: "No output" });
  assert.equal(empty.foldable, false);
});

test("hints: exit 127 or 'command not found' explains missing aliases; a prompt-shaped stall explains the missing keyboard", () => {
  const lines: Line[] = ["zsh: command not found: foo"];
  const e127 = describe(run({ kind: "failed", ...ended, exitCode: 127, signal: null, message: null }, { output: { lines: [], total: 0 } }), T0);
  assert.match(e127.hint ?? "", /aliases aren't loaded/);
  const text = describe(run({ kind: "ok", ...ended }, { output: { lines, total: 1 } }), T0);
  assert.match(text.hint ?? "", /aliases aren't loaded/);
  const tty = describe(run({ kind: "failed", ...ended, exitCode: 1, signal: null, message: null }, { output: { lines: ["sudo: a terminal is required to read the password"], total: 1 } }), T0);
  assert.match(tty.hint ?? "", /no keyboard/);
  // A known password prompt is a hint at once.
  const password = describe(run({ kind: "running", startedAt: T0, stopRequestedAt: null }, { output: { lines: ["Password:"], total: 1 }, lastOutputAt: T0 }), T0 + 1_000);
  assert.match(password.hint ?? "", /no keyboard/);
  // Any other line ending in ? or : counts only once the command has been silent for 8 s.
  const prompt = describe(run({ kind: "running", startedAt: T0, stopRequestedAt: null }, { output: { lines: ["Overwrite existing file?"], total: 1 }, lastOutputAt: T0 }), T0 + 9_000);
  assert.match(prompt.hint ?? "", /no keyboard/);
  const chatty = describe(run({ kind: "running", startedAt: T0, stopRequestedAt: null }, { output: { lines: ["Overwrite existing file?"], total: 1 }, lastOutputAt: T0 }), T0 + 2_000);
  assert.equal(chatty.hint, null, "a fresh prompt-shaped line is not yet a stall");
  assert.equal(describe(run({ kind: "ok", ...ended }), T0).hint, null);
});

test("a running row the daemon lost reads as interrupted at the moment it was lost", () => {
  const p = describe(run({ kind: "running", startedAt: T0, stopRequestedAt: null }, { lostAt: T0 + 41_000 }), T0 + 90_000);
  assert.equal(statusText(p), "Interrupted · 41s");
  assert.equal(p.badge, "unplug");
  assert.equal(p.timerFrom, null);
});

test("a dismissed proposal is one muted line with no actions", () => {
  const p = describe(run({ kind: "dismissed" }, { origin: "claude" }), T0);
  assert.equal(p.layout, "dismissed");
  assert.equal(p.label, "Dismissed");
  assert.deepEqual(p.actions, []);
});

test("durations read naturally at every scale", () => {
  assert.equal(formatDuration(40), "<0.1s");
  assert.equal(formatDuration(850), "0.8s");
  assert.equal(formatDuration(9_960), "9.9s");
  assert.equal(formatDuration(59_900), "59s");
  assert.equal(formatDuration(65_000), "1m 05s");
  assert.equal(formatDuration(3_720_000), "1h 02m");
});
