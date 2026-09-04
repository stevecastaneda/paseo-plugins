import assert from "node:assert/strict";
import { test } from "node:test";
import type { SetupCommand, SetupSnapshot } from "./setup.shared.ts";
import {
  commandLabel,
  completedDurationMs,
  formatDuration,
  headline,
  lastUsefulLogLine,
  liveLog,
  pillLabel,
  processCarriageReturns,
  relativeCwd,
  shortCommand,
  shouldShowPill,
  statusIconName,
  trimLog,
  trimSnapshot,
} from "./snapshot.ts";

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

test("lastUsefulLogLine walks up from the end and skips junk", () => {
  assert.equal(lastUsefulLogLine(""), null);
  assert.equal(
    lastUsefulLogLine("Syncing with origin...\nInstalling dependencies...\n"),
    "Installing dependencies...",
  );
  assert.equal(lastUsefulLogLine(`${"x".repeat(200)}\nadded 12 packages`), "added 12 packages");
});

test("statusIconName maps terminal states", () => {
  assert.equal(statusIconName("running"), "Package");
  assert.equal(statusIconName("completed"), "Check");
  assert.equal(statusIconName("failed"), "X");
});

test("pillLabel hides completed setup and names a live install", () => {
  assert.equal(shouldShowPill(null), false);
  assert.equal(pillLabel(null, 12_000), null);
  assert.equal(
    pillLabel(snapshot({ status: "completed", commands: [command({ command: "npm ci", status: "completed" })] }), 12_000),
    null,
  );
  assert.equal(
    pillLabel(snapshot({ status: "failed", error: "boom" }), 12_000),
    "setup failed",
  );
  assert.equal(
    pillLabel(
      snapshot({
        status: "running",
        log: "Installing dependencies...",
        commands: [command({ command: "./scripts/worktree-setup.sh", status: "running", log: "Installing dependencies..." })],
      }),
      72_000,
    ),
    "Installing dependencies... 1m 12s",
  );
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

test("liveLog prefers the running command's output", () => {
  const running = snapshot({
    status: "running",
    log: "overall",
    commands: [
      command({ index: 1, command: "npm ci", status: "completed", log: "done" }),
      command({ index: 2, command: "npm install", cwd: "/repo/api", status: "running", log: "fetching tarball" }),
    ],
  });
  assert.equal(liveLog(running), "fetching tarball");
  assert.equal(completedDurationMs(running.detail.commands), 0);
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
