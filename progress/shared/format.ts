// Display helpers shared by the panel and the `show` command. Times are shown
// in the viewer's local time zone.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Durations in the compact style the other plugins and most dashboards use:
// "45m", "2h", "2h 15m". Minutes are whole, so estimates read exactly as set.
export function formatMinutes(totalMin: number): string {
  const whole = Math.max(0, Math.floor(totalMin));
  if (whole < 1) return "<1m";
  const hours = Math.floor(whole / 60);
  const minutes = whole % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

// Estimated work done out of the total: "5m of 10m", "1h 30m of 2h".
// Once everything is done, how long it really took instead: "1h 20m".
export function formatWorkDone(doneMin: number, totalMin: number, tookMin?: number): string {
  if (tookMin !== undefined) return formatMinutes(tookMin);
  return `${doneMin < 1 ? "0m" : formatMinutes(doneMin)} of ${formatMinutes(totalMin)}`;
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${hours % 12 || 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

// Just the time, "2:08 AM", when it falls on the same day as `nowMs`; the full
// clock time otherwise.
export function formatTimeOfDay(iso: string, nowMs: number): string {
  const full = formatClock(iso);
  return new Date(iso).toDateString() === new Date(nowMs).toDateString() ? full.slice(full.indexOf(", ") + 2) : full;
}

export function formatAgo(iso: string, nowMs: number): string {
  const minutes = (nowMs - Date.parse(iso)) / 60_000;
  return minutes < 1 ? "just now" : `${formatMinutes(minutes)} ago`;
}

export function minutesSince(iso: string, nowMs: number): number {
  return Math.max(0, (nowMs - Date.parse(iso)) / 60_000);
}
