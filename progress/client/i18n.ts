import type { Dashboard, HeadlinePart } from "../shared/dashboard";
import type { LanguagePreference } from "../shared/settings";
import type { TimelineLabel } from "../shared/ticket-story";
import type { ProgressMessages } from "./messages";
import { messages as en } from "./locales/en";
import { messages as zhCN } from "./locales/zh-CN";

export type { ProgressMessages } from "./messages";
export type ProgressLocale = "en" | "zh-CN";

export function systemLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "en";
  }
}

export function resolveLocale(preference: LanguagePreference, system = systemLocale()): ProgressLocale {
  if (preference !== "system") return preference;
  const [language, ...subtags] = system.replaceAll("_", "-").toLowerCase().split("-");
  if (language !== "zh" || subtags.some((part) => ["hant", "tw", "hk", "mo"].includes(part))) return "en";
  return subtags.length === 0 || subtags.some((part) => ["hans", "cn", "sg"].includes(part)) ? "zh-CN" : "en";
}

export function messagesFor(locale: ProgressLocale): ProgressMessages {
  return locale === "zh-CN" ? zhCN : en;
}

export function formatClientMinutes(locale: ProgressLocale, totalMin: number): string {
  const m = messagesFor(locale);
  const whole = Math.max(0, Math.floor(totalMin));
  if (whole < 1) return m.lessThanMinute;
  const hours = Math.floor(whole / 60);
  const minutes = whole % 60;
  return !hours ? m.minutes(minutes) : minutes ? m.hoursMinutes(hours, minutes) : m.hours(hours);
}

export function formatClientWorkDone(locale: ProgressLocale, doneMin: number, totalMin: number, tookMin?: number): string {
  if (tookMin !== undefined) return formatClientMinutes(locale, tookMin);
  const m = messagesFor(locale);
  return m.workDone(doneMin < 1 ? m.zeroMinutes : formatClientMinutes(locale, doneMin), formatClientMinutes(locale, totalMin));
}

export function formatClientClock(locale: ProgressLocale, iso: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function formatClientTimeOfDay(locale: ProgressLocale, iso: string, nowMs: number): string {
  const date = new Date(iso);
  const now = new Date(nowMs);
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return sameDay ? new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date) : formatClientClock(locale, iso);
}

export function formatClientAgo(locale: ProgressLocale, iso: string, nowMs: number): string {
  const m = messagesFor(locale);
  const minutes = (nowMs - Date.parse(iso)) / 60_000;
  return minutes < 1 ? m.justNow : m.ago(formatClientMinutes(locale, minutes));
}

export function clientHeadline(locale: ProgressLocale, dashboard: Dashboard): HeadlinePart[] {
  const m = messagesFor(locale);
  const counted = dashboard.tickets.filter((ticket) => ticket.status !== "skipped");
  const done = counted.filter((ticket) => ticket.status === "done").length;
  const parts: HeadlinePart[] = [{ text: m.headlineDone(done, counted.length, dashboard.run?.itemLabel ?? "Ticket"), tone: "normal" }];
  if (dashboard.questions.open.length) parts.push({ text: m.questionsWaiting(dashboard.questions.open.length), tone: "normal" });
  if (dashboard.stuck.length) parts.push({ text: m.stuckCount(dashboard.stuck.length), tone: "danger" });
  return parts;
}

export function timelineLabel(m: ProgressMessages, label: TimelineLabel): string {
  switch (label.kind) {
    case "added": return m.added;
    case "reset": return m.resetStatus;
    case "stage": return m.stageLabel(label.stage);
    case "status": return m.status[label.status];
  }
}
