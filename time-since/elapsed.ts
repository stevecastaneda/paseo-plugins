const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const DROP_SECONDS_AFTER = 5 * MINUTE;

export function formatElapsed(ms: number): string {
  const elapsed = Math.max(0, Math.floor(ms));
  if (elapsed < MINUTE) {
    return `${Math.floor(elapsed / SECOND)}s`;
  }
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    const seconds = Math.floor((elapsed % MINUTE) / SECOND);
    if (elapsed >= DROP_SECONDS_AFTER || seconds === 0) return `${minutes}m`;
    return `${minutes}m ${seconds}s`;
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

export function isWorkingStatus(
  status: "initializing" | "idle" | "running" | "error" | "closed" | null | undefined,
): boolean {
  return status === "running" || status === "initializing";
}

export function formatTimeSinceLabel(lastActivityAt: string, nowMs: number): string | null {
  const started = Date.parse(lastActivityAt);
  if (Number.isNaN(started)) return null;
  return formatElapsed(nowMs - started);
}

export function isThreadMessageType(type: string | undefined): boolean {
  return type === "user_message" || type === "assistant_message";
}

export type TimelineStamp = {
  timestamp: string;
  item: { type: string };
};

export function lastThreadMessageAt(entries: readonly TimelineStamp[]): string | null {
  let lastMessage: string | null = null;
  let lastMessageMs = Number.NEGATIVE_INFINITY;
  let lastAny: string | null = null;
  let lastAnyMs = Number.NEGATIVE_INFINITY;

  for (const entry of entries) {
    const ms = Date.parse(entry.timestamp);
    if (Number.isNaN(ms)) continue;
    if (ms >= lastAnyMs) {
      lastAnyMs = ms;
      lastAny = entry.timestamp;
    }
    if (!isThreadMessageType(entry.item.type)) continue;
    if (ms >= lastMessageMs) {
      lastMessageMs = ms;
      lastMessage = entry.timestamp;
    }
  }

  return lastMessage ?? lastAny;
}

export function lastThreadMessageAtFromStream(payload: {
  timestamp?: string;
  event?: { type?: string; item?: { type?: string } };
}): string | null {
  if (payload.event?.type !== "timeline") return null;
  if (!isThreadMessageType(payload.event.item?.type)) return null;
  const at = payload.timestamp;
  if (!at || Number.isNaN(Date.parse(at))) return null;
  return at;
}
