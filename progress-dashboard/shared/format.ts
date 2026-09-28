// Display helpers shared by the panel and the `show` command. Times are shown
// in the viewer's local time zone.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMinutes(totalMin: number): string {
  const whole = Math.max(0, Math.floor(totalMin));
  if (whole < 1) return "<1 min";
  const hours = Math.floor(whole / 60);
  const minutes = whole % 60;
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function formatHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1).replace(/\.0$/, "")} h`;
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${hours % 12 || 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

export function formatAgo(iso: string, nowMs: number): string {
  const minutes = (nowMs - Date.parse(iso)) / 60_000;
  return minutes < 1 ? "just now" : `${formatMinutes(minutes)} ago`;
}

export function minutesSince(iso: string, nowMs: number): number {
  return Math.max(0, (nowMs - Date.parse(iso)) / 60_000);
}
