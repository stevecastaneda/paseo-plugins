import assert from "node:assert/strict";
import { test } from "node:test";
import type { SetupCommand, SetupSnapshot } from "../shared/setup.ts";
import {
  commandLabel,
  completedDurationMs,
  formatDuration,
  headline,
  buttonLabel,
  processCarriageReturns,
  relativeCwd,
  shortCommand,
  shouldShowButton,
  statusIconName,
  trimLog,
  trimSnapshot,
} from "../shared/snapshot.ts";

function command(partial: Partial<SetupCommand> & Pick<SetupCommand, "command" | "status">): SetupCommand {
  return {
    index: partial.index ?? 1,
    cwd: partial.cwd ?? "/repo",
    log: partial.log ?? "",
    exitCode: partial.exitCode ?? (partial.status === "completed" ? 0 : null),
    durationMs: partial.durationMs,
    command: partial.command,
    status: partial.status,
  };
}

function snapshot(partial: {
  status: SetupSnapshot["status"];
  error?: string | null;
  commands?: SetupCommand[];
  log?: string;
}): SetupSnapshot {
  return {
    status: partial.status,
    error: partial.error ?? null,
    detail: {
      type: "worktree_setup",
      worktreePath: "/repo",
      branchName: "feat",
      log: partial.log ?? "",
      commands: partial.commands ?? [],
    },
  };
}

test("formatDuration reports seconds, then minutes, then hours", () => {
  assert.equal(formatDuration(-20), "0s");
  assert.equal(formatDuration(12_000), "12s");
  assert.equal(formatDuration(60_000), "1m");
  assert.equal(formatDuration(90_000), "1m 30s");
  assert.equal(formatDuration(3_600_000), "1h");
  assert.equal(formatDuration(3_660_000), "1h 1m");
});

test("processCarriageReturns keeps the latest progress-bar segment", () => {
  assert.equal(processCarriageReturns("plain"), "plain");
  assert.equal(processCarriageReturns("aaa\rbbb\rccc"), "ccc");
  assert.equal(processCarriageReturns("keep\nfoo\rbar\nbaz"), "keep\nbar\nbaz");
});

test("relativeCwd strips the worktree root", () => {
  assert.equal(relativeCwd("/repo", "/repo"), ".");
  assert.equal(relativeCwd("/repo/functions", "/repo"), "functions");
  assert.equal(relativeCwd("/elsewhere", "/repo"), "/elsewhere");
});

test("shortCommand prefers the package-manager verb", () => {
  assert.equal(shortCommand("./scripts/worktree-setup.sh"), "worktree-setup.sh");
  assert.equal(shortCommand("cd functions && npm install"), "npm install");
  assert.equal(shortCommand("pnpm i"), "pnpm i");
  assert.equal(shortCommand("npm run db:migrate"), "npm run db:migrate");
});

test("statusIconName maps terminal states", () => {
  assert.equal(statusIconName("running"), "Package");
  assert.equal(statusIconName("completed"), "CircleCheck");
  assert.equal(statusIconName("failed"), "CircleAlert");
});

test("a finished setup stays until dismissed, and only if this session saw it run", () => {
  const done = snapshot({ status: "completed", commands: [command({ command: "npm ci", status: "completed" })] });
  const failed = snapshot({ status: "failed", error: "boom" });
  const running = snapshot({ status: "running" });
  assert.equal(shouldShowButton(null), false);
  assert.equal(shouldShowButton(running, { sawRunning: false, dismissed: true }), true);
  assert.equal(shouldShowButton(done, { sawRunning: true, dismissed: false }), true);
  assert.equal(shouldShowButton(done, { sawRunning: false, dismissed: false }), false, "old worktrees stay quiet");
  assert.equal(shouldShowButton(done, { sawRunning: true, dismissed: true }), false);
  assert.equal(shouldShowButton(failed, { sawRunning: false, dismissed: false }), true);
  assert.equal(shouldShowButton(failed, { sawRunning: false, dismissed: true }), false);
});

test("buttonLabel stays short", () => {
  assert.equal(buttonLabel(null, 12_000), null);
  assert.equal(buttonLabel(snapshot({ status: "failed", error: "boom" }), 12_000), "Setup failed");
  assert.equal(buttonLabel(snapshot({ status: "running" }), 72_000), "Setup 1m 12s");
  assert.equal(buttonLabel(snapshot({ status: "completed" }), 72_000), "Setup 1m 12s");
});

test("headline and commandLabel describe the current step", () => {
  assert.equal(
    headline(snapshot({ status: "failed", error: "npm ERR! EPERM" })),
    "npm ERR! EPERM",
  );
  assert.equal(
    headline(
      snapshot({
        status: "completed",
        commands: [command({ command: "npm ci", status: "completed", durationMs: 90_000 })],
      }),
    ),
    "Setup finished in 1m 30s",
  );
  assert.equal(
    commandLabel(command({ command: "npm install", cwd: "/repo/api", status: "running" }), "/repo"),
    "npm install in api",
  );
});

test("trimSnapshot keeps the tail of oversized logs", () => {
  const huge = "n".repeat(9_000);
  const trimmed = trimSnapshot(
    snapshot({
      status: "running",
      log: huge,
      commands: [command({ command: "npm ci", status: "running", log: huge })],
    }),
  );
  assert.equal(trimmed.detail.log.length, 8_000);
  assert.equal(trimmed.detail.commands[0]?.log.length, 8_000);
  assert.equal(trimmed.detail.truncated, true);
  assert.equal(trimLog("short"), "short");
});
