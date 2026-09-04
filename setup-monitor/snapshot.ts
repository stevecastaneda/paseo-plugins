import type { SetupCommand, SetupSnapshot, SetupStatus } from "./setup.shared.ts";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const MAX_LOG_CHARS = 8_000;
const MAX_PILL_LINE = 48;

export function formatDuration(ms: number): string {
  const elapsed = Math.max(0, Math.floor(ms));
  if (elapsed < MINUTE) {
    return `${Math.floor(elapsed / SECOND)}s`;
  }
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    const seconds = Math.floor((elapsed % MINUTE) / SECOND);
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(elapsed / HOUR);
  const minutes = Math.floor((elapsed % HOUR) / MINUTE);
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export function trimLog(log: string, maxChars = MAX_LOG_CHARS): string {
  if (log.length <= maxChars) return log;
  return log.slice(log.length - maxChars);
}

/** npm progress bars rewrite the current line with `\r`. Keep the last segment. */
export function processCarriageReturns(text: string): string {
  if (!text.includes("\r")) return text;
  return text
    .split("\n")
    .map((line) => {
      if (!line.includes("\r")) return line;
      const segments = line.split("\r");
      return segments[segments.length - 1] ?? "";
    })
    .join("\n");
}

export function relativeCwd(cwd: string, worktreePath: string): string {
  const root = worktreePath.replace(/\/+$/, "");
  if (cwd === root) return ".";
  const prefix = `${root}/`;
  if (cwd.startsWith(prefix)) return cwd.slice(prefix.length);
  return cwd;
}

export function shortCommand(command: string): string {
  const first = command.trim().split(/\n/)[0]?.trim() ?? "";
  if (!first) return "setup";
  const install = first.match(
    /\b((?:npm|pnpm|yarn|bun)(?:\s+(?:install|ci|i|run\s+\S+))?)\b/i,
  );
  if (install?.[1]) return install[1].replace(/\s+/g, " ");
  const withoutCd = first.replace(/^cd\s+\S+\s*&&\s*/, "");
  const base = withoutCd.match(/([^/\s]+)$/);
  const candidate = (base?.[1] ?? withoutCd).replace(/['"]/g, "");
  return candidate.length > 0 ? candidate : "setup";
}

export function lastUsefulLogLine(log: string): string | null {
  const lines = log.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.replace(/\r/g, "").trim() ?? "";
    if (!line) continue;
    if (line.length > 120) continue;
    if (/^[|*\-.\s]+$/.test(line)) continue;
    if (line.length <= MAX_PILL_LINE) return line;
    return `${line.slice(0, MAX_PILL_LINE - 1)}…`;
  }
  return null;
}

export function runningCommand(commands: readonly SetupCommand[]): SetupCommand | null {
  return commands.find((command) => command.status === "running") ?? null;
}

export function failedCommand(commands: readonly SetupCommand[]): SetupCommand | null {
  return commands.find((command) => command.status === "failed") ?? null;
}

export function completedDurationMs(commands: readonly SetupCommand[]): number {
  let total = 0;
  for (const command of commands) {
    if (typeof command.durationMs === "number") total += command.durationMs;
  }
  return total;
}

export function liveLog(snapshot: SetupSnapshot): string {
  const running = runningCommand(snapshot.detail.commands);
  if (running?.log) return running.log;
  const failed = failedCommand(snapshot.detail.commands);
  if (failed?.log) return failed.log;
  return snapshot.detail.log;
}

export function shouldShowPill(snapshot: SetupSnapshot | null): boolean {
  return snapshot?.status === "running" || snapshot?.status === "failed";
}

export function statusIconName(status: SetupStatus): "Check" | "X" | "Package" {
  if (status === "completed") return "Check";
  if (status === "failed") return "X";
  return "Package";
}

export function pillLabel(snapshot: SetupSnapshot | null, elapsedMs: number): string | null {
  if (!snapshot || !shouldShowPill(snapshot)) return null;
  const elapsed = formatDuration(elapsedMs);
  if (snapshot.status === "failed") return "setup failed";
  const running = runningCommand(snapshot.detail.commands);
  const line = lastUsefulLogLine(liveLog(snapshot));
  if (line && line.length <= 28) return `${line} ${elapsed}`;
  const command = running ? shortCommand(running.command) : "setup";
  return `${command} ${elapsed}`;
}

export function headline(snapshot: SetupSnapshot): string {
  if (snapshot.status === "failed") {
    return snapshot.error?.trim() || "Setup failed";
  }
  if (snapshot.status === "completed") {
    const duration = completedDurationMs(snapshot.detail.commands);
    return duration > 0 ? `Setup finished in ${formatDuration(duration)}` : "Setup finished";
  }
  const running = runningCommand(snapshot.detail.commands);
  return running ? shortCommand(running.command) : "Setting up worktree";
}

export function commandLabel(command: SetupCommand, worktreePath: string): string {
  const name = shortCommand(command.command);
  const cwd = relativeCwd(command.cwd, worktreePath);
  if (cwd === "." || cwd === command.cwd) return name;
  return `${name} in ${cwd}`;
}

export function statusColor(
  status: SetupStatus,
  colors: {
    accent: string;
    statusSuccess: string;
    statusDanger: string;
    foregroundMuted: string;
  },
): string {
  if (status === "running") return colors.accent;
  if (status === "completed") return colors.statusSuccess;
  if (status === "failed") return colors.statusDanger;
  return colors.foregroundMuted;
}

export function trimSnapshot(snapshot: SetupSnapshot): SetupSnapshot {
  const commands = snapshot.detail.commands.map((command) => ({
    ...command,
    log: trimLog(command.log),
  }));
  return {
    ...snapshot,
    detail: {
      ...snapshot.detail,
      log: trimLog(snapshot.detail.log),
      commands,
      truncated:
        snapshot.detail.truncated === true ||
        snapshot.detail.log.length > MAX_LOG_CHARS ||
        snapshot.detail.commands.some((command) => command.log.length > MAX_LOG_CHARS),
    },
  };
}
