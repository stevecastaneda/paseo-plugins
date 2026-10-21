import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { clientHarness } from "../../test-support/client-harness.mjs";
import type { Dashboard, Ticket } from "../shared/dashboard.ts";
import type { TimelineStep } from "../shared/ticket-story.ts";
import type { ProgressLocale } from "./i18n.ts";

const directory = fileURLToPath(new URL("..", import.meta.url));
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test("explicit preferences override system locale without selecting Simplified for Traditional Chinese", () => {
  const { resolveLocale } = clientHarness(directory).load("client/i18n.ts");
  for (const system of ["zh", "zh-CN", "zh_SG", "zh-Hans", "zh-Hans-CN", "ZH-hans-sg"]) assert.equal(resolveLocale("system", system), "zh-CN", system);
  for (const system of ["", "en-US", "fr-FR", "zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-Hant-CN", "zh-Hans-TW", "zh-US"]) assert.equal(resolveLocale("system", system), "en", system);
  assert.equal(resolveLocale("en", "zh-CN"), "en");
  assert.equal(resolveLocale("zh-CN", "en-US"), "zh-CN");
});

test("display preferences and question behavior have separate documents and defaults", () => {
  const { displaySettings, questionSettings } = clientHarness(directory).load("shared/settings.ts");
  assert.equal(displaySettings.id, "display");
  assert.equal(displaySettings.scope, "host");
  assert.equal(questionSettings.id, "questions");
  assert.deepEqual(plain(displaySettings.schema.parse({})), { language: "system" });
  assert.deepEqual(plain(questionSettings.schema.parse({})), { mode: "work-around" });
  assert.equal(displaySettings.schema.safeParse({ language: "fr" }).success, false);
  assert.deepEqual(plain(questionSettings.schema.parse({ mode: "stop", language: "zh-CN" })), { mode: "stop" });
});

test("catalogs cover statuses, modes and note kinds while preserving authored interpolation", () => {
  const { messagesFor } = clientHarness(directory).load("client/i18n.ts");
  const en = messagesFor("en");
  const zh = messagesFor("zh-CN");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  assert.deepEqual(Object.keys(en.status), Object.keys(zh.status));
  assert.deepEqual(Object.keys(en.questionModes), ["stop", "work-around", "keep-building"]);
  assert.deepEqual(Object.keys(en.noteKinds), Object.keys(zh.noteKinds));
  assert.deepEqual([0, 1, 2].map(en.questionCount), ["0 questions", "1 question", "2 questions"]);
  assert.deepEqual([0, 1, 2].map(zh.questionCount), ["0 个问题", "1 个问题", "2 个问题"]);
  const authored = "API ${x} <b>Quoted</b> /tmp/My File.md";
  for (const m of [en, zh]) {
    assert.ok(m.openItem(authored).includes(authored));
    assert.ok(m.copyItemPath(authored).includes(authored));
    assert.ok(m.stageLabel(authored).includes(authored));
    assert.ok(m.headlineDone(1, 2, authored).includes(authored));
    assert.ok(m.itemHeading(authored).startsWith(authored));
  }
  assert.equal(zh.itemHeading("Ticket"), "Ticket");
});

test("client duration boundaries localize while shared CLI formatters remain English", () => {
  const h = clientHarness(directory);
  const { formatClientMinutes, formatClientWorkDone, formatClientAgo } = h.load("client/i18n.ts");
  const { formatMinutes, formatWorkDone } = h.load("shared/format.ts");
  const cases: Array<[number, string, string]> = [[-1, "<1m", "<1 分钟"], [0, "<1m", "<1 分钟"], [0.99, "<1m", "<1 分钟"], [1, "1m", "1 分钟"], [59.9, "59m", "59 分钟"], [60, "1h", "1 小时"], [61, "1h 1m", "1 小时 1 分钟"], [120, "2h", "2 小时"]];
  for (const [minutes, en, zh] of cases) {
    assert.equal(formatClientMinutes("en", minutes), en);
    assert.equal(formatClientMinutes("zh-CN", minutes), zh);
    assert.equal(formatMinutes(minutes), en);
  }
  assert.equal(formatClientWorkDone("zh-CN", 0, 90), "0 分钟 / 1 小时 30 分钟");
  assert.equal(formatClientWorkDone("zh-CN", 30, 90, 62), "1 小时 2 分钟");
  assert.equal(formatWorkDone(0, 90), "0m of 1h 30m");
  const now = Date.parse("2026-10-21T12:00:00Z");
  assert.equal(formatClientAgo("zh-CN", new Date(now - 59_999).toISOString(), now), "刚刚");
  assert.equal(formatClientAgo("zh-CN", new Date(now - 60_000).toISOString(), now), "1 分钟前");
  assert.equal(formatClientAgo("en", new Date(now - 60_000).toISOString(), now), "1m ago");
});

test("clock formatting uses explicit locales and local calendar-day boundaries", () => {
  const { formatClientClock, formatClientTimeOfDay } = clientHarness(directory).load("client/i18n.ts");
  const at = new Date(2026, 9, 21, 13, 8);
  for (const locale of ["en", "zh-CN"]) {
    const full = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(at);
    const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(at);
    assert.equal(formatClientClock(locale, at.toISOString()), full);
    assert.equal(formatClientTimeOfDay(locale, at.toISOString(), new Date(2026, 9, 21, 23, 59).getTime()), time);
    assert.equal(formatClientTimeOfDay(locale, at.toISOString(), new Date(2026, 9, 22).getTime()), full);
    assert.equal(formatClientTimeOfDay(locale, at.toISOString(), new Date(2027, 9, 21).getTime()), full);
  }
});

test("headlines derive from structured counts while preserving server copy and custom item labels", () => {
  const h = clientHarness(directory);
  const { clientHeadline } = h.load("client/i18n.ts");
  const { EMPTY_DASHBOARD } = h.load("shared/dashboard.ts");
  const ticket = (status: Ticket["status"]): Ticket => ({ id: "T01", title: "Authored title", estimateMin: 10, status, statusSince: "2026-10-21T00:00:00Z", history: [] });
  const dashboard: Dashboard = { ...EMPTY_DASHBOARD, run: { title: "Authored run", startedAt: "2026-10-21T00:00:00Z", itemLabel: "API Task" },
    tickets: [ticket("done"), ticket("working"), ticket("skipped")], headline: [{ text: "Server copy", tone: "normal" }],
    questions: { open: [{ id: "Q1", title: "Choice", question: "Question?", options: [], recommended: "A", state: "waiting", files: [], askedAt: "2026-10-21T00:00:00Z" }], answered: [] },
    stuck: [{ kind: "manual", key: "manual:S1", id: "S1", title: "Authored blocker", reason: "Authored reason", since: "2026-10-21T00:00:00Z" }] };
  assert.deepEqual(plain(clientHeadline("zh-CN", dashboard)), [{ text: "API Task 已完成 1/2", tone: "normal" }, { text: "1 个问题等待你的回答", tone: "normal" }, { text: "1 项受阻", tone: "danger" }]);
  assert.equal(dashboard.headline[0].text, "Server copy");
});

test("timeline descriptors preserve English labels and distinguish Added from later not-started steps", () => {
  const h = clientHarness(directory);
  const { ticketTimeline } = h.load("shared/ticket-story.ts");
  const { timelineLabel, messagesFor } = h.load("client/i18n.ts");
  const steps: TimelineStep[] = ticketTimeline({ history: [
    { at: "2026-10-21T00:00:00Z", status: "not_started" },
    { at: "2026-10-21T00:01:00Z", status: "working", stage: "Authored stage" },
    { at: "2026-10-21T00:02:00Z", status: "not_started" },
    { at: "2026-10-21T00:03:00Z", status: "done" },
  ] }, Date.parse("2026-10-21T00:04:00Z"));
  assert.deepEqual(plain(steps.map((step) => step.label)), ["Added", "Authored stage stage", "Back to not started", "Done"]);
  assert.deepEqual(plain(steps.map((step) => step.labelDescriptor.kind)), ["added", "stage", "reset", "status"]);
  assert.deepEqual(plain(steps.map((step) => timelineLabel(messagesFor("zh-CN"), step.labelDescriptor))), ["已添加", "Authored stage 阶段", "恢复为未开始", "已完成"]);
});

function languageHarness() {
  let preference: ProgressLocale = "en";
  let status = "ready";
  let current: unknown;
  const effects: Array<() => void> = [];
  const cleanups: Array<() => void> = [];
  const definitions: string[] = [];
  const h = clientHarness(directory, {
    react: { ...React, useContext: () => current, useEffect: (effect: () => void) => effects.push(effect),
      useSyncExternalStore: (subscribe: (listener: () => void) => () => void, snapshot: () => unknown) => { cleanups.push(subscribe(() => {})); return snapshot(); } },
    "@getpaseo/plugin/client": { useSettings: (definition: { id: string }) => {
      definitions.push(definition.id);
      return status === "ready" ? { status, values: { language: preference }, revision: "r1" } : { status, error: "Raw host error" };
    } },
  });
  function renderProvider() {
    const rendered = h.load("client/language.tsx").ProgressLanguageProvider({ children: null });
    current = rendered.props.value;
    return rendered.props.value;
  }
  return { h, effects, cleanups, definitions, renderProvider,
    setLanguage(value: ProgressLocale) { preference = value; renderProvider(); },
    setStatus(value: string) { status = value; return renderProvider(); } };
}

test("pending and failed settings reads leave content usable, and a saved override updates the provider", () => {
  const h = languageHarness();
  for (const status of ["loading", "error", "invalid"]) {
    const language = h.setStatus(status);
    assert.ok(language.messages.questions);
    assert.equal(language.settings.status, status);
  }
  h.setStatus("ready");
  h.setLanguage("zh-CN");
  assert.equal(h.renderProvider().messages.questions, "问题");
  assert.ok(h.definitions.every((id) => id === "display"));
});

test("pill icons update same-mode titles and labels without extra polls and ignore late effects after cleanup", async () => {
  for (const attention of [true, false]) {
    const { h, effects, cleanups, setLanguage } = languageHarness();
    h.responses["progress.attention"] = { configured: true, questions: attention ? 2 : 0, stuck: attention ? 1 : 0, runOpen: true, panelOpened: attention };
    const stop = h.load("client/pills.tsx").contributePills(h.client);
    h.agents.bootstrap([{ agent: { id: "a", workspaceId: "w" } }]);
    h.workspaces.bootstrap([{ id: "w", workspaceDirectory: "/w", projectRootPath: "/w" }]);
    await h.flush();
    const [pill] = h.registrations;
    assert.equal(pill.button.title, attention ? "Progress needs you" : "Open Progress");
    assert.equal(pill.button.label, attention ? "2Q · 1 stuck" : "Progress");
    const timers = h.timers.size;
    setLanguage("zh-CN");
    const renderIcon = () => {
      const icon = pill.button.icon({ workspaceId: "w", size: 12, color: "gray", theme: { colors: {} } });
      const child = icon.props.children;
      child.type(child.props);
    };
    renderIcon();
    effects.shift()?.();
    assert.equal(pill.button.title, attention ? "Progress 需要你处理" : "打开 Progress");
    assert.equal(pill.button.label, attention ? "2 问 · 1 项受阻" : "Progress");
    assert.equal(h.registrations.length, 1);
    assert.equal(pill.removed, false);
    assert.equal(h.timers.size, timers);
    setLanguage("en");
    renderIcon();
    effects.shift()?.();
    assert.equal(pill.button.title, attention ? "Progress needs you" : "Open Progress");
    assert.equal(pill.button.label, attention ? "2Q · 1 stuck" : "Progress");
    setLanguage("zh-CN");
    renderIcon();
    const updates = pill.updates;
    stop();
    effects.shift()?.();
    assert.equal(pill.updates, updates);
    for (const cleanup of cleanups) cleanup();
    assert.equal(h.timers.size, 0);
    assert.equal(h.agents.listenerCount, 0);
    assert.equal(h.workspaces.listenerCount, 0);
  }
});
