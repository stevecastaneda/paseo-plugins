const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatElapsed(ms: number): string {
  const elapsed = Math.max(0, Math.floor(ms));
  if (elapsed < MINUTE) {
    return `${Math.floor(elapsed / SECOND)}s`;
  }
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    const seconds = Math.floor((elapsed % MINUTE) / SECOND);
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    const minutes = Math.floor((elapsed % HOUR) / MINUTE);
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  const days = Math.floor(elapsed / DAY);
  const hours = Math.floor((elapsed % DAY) / HOUR);
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

export function formatTimeSinceLabel(
  lastActivityAt: string,
  status: "initializing" | "idle" | "running" | "error" | "closed",
  nowMs: number,
): string | null {
  const started = Date.parse(lastActivityAt);
  if (Number.isNaN(started)) return null;
  const elapsed = formatElapsed(nowMs - started);
  if (status === "running" || status === "initializing") {
    return `working ${elapsed}`;
  }
  return `${elapsed} ago`;
}
