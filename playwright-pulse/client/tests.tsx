import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import React, { useState } from "react";
import { Text, View } from "react-native";
import type { PulseTest, RunSnapshot } from "../shared/run";
import { attachmentKind, errorPreview, failureMessage, formatClock, formatDuration, isFailure, testWhere, timeoutShare, verdict, verdictNote, type AttachmentKind, type Counts } from "../shared/view";
import { IconSwap, PressScale } from "./motion";
import { mono } from "./mono";
import { useNarrow } from "./narrow";
import { PressableRow } from "./row";
import { SectionTitle } from "./section-title";
import { Spinner, WaitingDot } from "./spinner";
import { raised } from "./surfaces";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

export interface AttachmentActions {
  preview(test: PulseTest, index: number): void;
  open(file: { testId: string; index: number; path: string }, kind: AttachmentKind): void;
}

function Card({ colors, children, tone }: { colors: Colors; children: React.ReactNode; tone?: "danger" }) {
  return (
    <View style={{ margin: 12, marginBottom: 0, borderRadius: 6, overflow: "hidden",
      ...(tone === "danger" ? { borderWidth: 1, borderColor: colors.statusDanger } : raised(colors)) }}>
      {children}
    </View>
  );
}

// Seconds a step must run before its own clock shows: most finish in a blink.
const SLOW_STEP_MS = 2_000;

// The test running now, its live step, and the steps just before it.
export function RunningSection({ colors, tests, now }: { colors: Colors; tests: PulseTest[]; now: number }) {
  return (
    <Card colors={colors}>
      <SectionTitle colors={colors} icon="Play" title={tests.length === 1 ? "Running now" : `Running now (${tests.length})`} />
      {tests.map((test) => <RunningTest key={test.id} colors={colors} test={test} now={now} />)}
    </Card>
  );
}

function RunningTest({ colors, test, now }: { colors: Colors; test: PulseTest; now: number }) {
  const elapsed = test.startedAt ? now - Date.parse(test.startedAt) : 0;
  const share = timeoutShare(test, now);
  const stepElapsed = test.step ? now - Date.parse(test.step.startedAt) : 0;
  const trail = [...(test.recentSteps ?? [])].reverse().slice(0, 3);
  return (
    <View style={{ paddingHorizontal: 10, paddingTop: 10, paddingBottom: 12, gap: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface1 }}>
      <View style={{ gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{test.title}</Text>
          {test.retry ? <Badge colors={colors} color={colors.statusWarning} label={`Retry ${test.retry}`} /> : null}
          <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] }}>{formatClock(elapsed)}</Text>
        </View>
        <Text numberOfLines={2} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{testWhere(test)}</Text>
      </View>
      <View style={{ borderRadius: 4, backgroundColor: colors.surface0, ...raised(colors), overflow: "hidden" }}>
        <StepLine colors={colors} live icon={<Spinner color={colors.accent} size={12} />}
          title={test.step?.title ?? "Setting up"} subtitle={test.step?.subtitle}
          context={test.step?.context} time={stepElapsed >= SLOW_STEP_MS ? formatClock(stepElapsed) : undefined} />
        {trail.map((step, index) => (
          <StepLine key={`${index}-${step.title}`} colors={colors} faded={index + 1}
            icon={<Icon name={step.failed ? "X" : "Check"} size={12} color={step.failed ? colors.statusDanger : colors.statusSuccess} />}
            title={step.title} subtitle={step.subtitle} time={formatDuration(step.duration)} />
        ))}
      </View>
      {share !== null ? <TimeoutBar colors={colors} share={share} timeout={test.timeout} /> : null}
    </View>
  );
}

// One step: icon, title, the locator or URL it acted on, and its time.
function StepLine({ colors, icon, title, subtitle, context, time, live, faded = 0 }: {
  colors: Colors; icon: React.ReactNode; title: string; subtitle?: string; context?: string; time?: string; live?: boolean; faded?: number;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 8, paddingVertical: 6, opacity: 1 - faded * 0.18,
      borderTopWidth: live ? 0 : 1, borderTopColor: colors.border }}>
      <View style={{ width: 12, paddingTop: 3, alignItems: "center" }}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={live ? 3 : 1} style={{ color: live ? colors.foreground : colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
          <Text style={{ fontWeight: live ? "600" : "400" }}>{title}</Text>
          {subtitle ? <Text style={{ fontFamily: mono(), fontSize: 11, color: colors.foregroundMuted }}>{"  "}{subtitle}</Text> : null}
        </Text>
        {live && context ? <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>in {context}</Text> : null}
      </View>
      {time ? <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 18, fontVariant: ["tabular-nums"] }}>{time}</Text> : null}
    </View>
  );
}

// How much of its timeout the test has used. Amber past three quarters.
function TimeoutBar({ colors, share, timeout }: { colors: Colors; share: number; timeout: number }) {
  const late = share >= 0.75;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.surface2, overflow: "hidden" }}>
        <View style={{ width: `${Math.round(share * 100)}%`, height: 3, backgroundColor: late ? colors.statusWarning : colors.foregroundMuted, opacity: late ? 1 : 0.5 }} />
      </View>
      <Text style={{ color: late ? colors.statusWarning : colors.foregroundMuted, fontSize: 11, lineHeight: 16, fontVariant: ["tabular-nums"] }}>
        {formatDuration(timeout)} timeout
      </Text>
    </View>
  );
}

function Badge({ colors, color, label }: { colors: Colors; color: string; label: string }) {
  return (
    <View style={{ paddingHorizontal: 5, borderRadius: 4, borderWidth: 1, borderColor: color, marginTop: 1 }}>
      <Text style={{ color, fontSize: 10, lineHeight: 14, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

// Failures stay pinned above the rest until the next run, each with its error
// and the files Playwright kept.
export function FailuresSection({ colors, run, actions }: { colors: Colors; run: RunSnapshot; actions: AttachmentActions }) {
  const failures = run.tests.filter(isFailure);
  return (
    <Card colors={colors} tone="danger">
      <SectionTitle colors={colors} icon="CircleX" title={failures.length === 1 ? "1 failure" : `${failures.length} failures`} color={colors.statusDanger} />
      {failures.map((test) => <Failure key={test.id} colors={colors} test={test} actions={actions} />)}
    </Card>
  );
}

const KIND_ORDER: AttachmentKind[] = ["screenshot", "video", "trace"];
const KIND_LABEL: Record<AttachmentKind, string> = { screenshot: "Screenshot", video: "Video", trace: "Trace", other: "File" };
const KIND_ICON: Record<AttachmentKind, string> = { screenshot: "Image", video: "Video", trace: "Footprints", other: "File" };

function Failure({ colors, test, actions }: { colors: Colors; test: PulseTest; actions: AttachmentActions }) {
  const [expanded, setExpanded] = useState(false);
  const toast = useToast();
  const message = failureMessage(test, formatDuration);
  const preview = errorPreview(message);
  const files = test.attachments
    .map((attachment, index) => ({ attachment, index, kind: attachmentKind(attachment) }))
    .filter((file) => file.kind !== "other")
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  // One button per kind: retries can leave several of each; the last is the final try.
  const byKind = new Map(files.map((file) => [file.kind, file]));
  const copy = () => {
    const text = [`${test.title} (${test.file}:${test.line})`, message, test.error?.snippet].filter(Boolean).join("\n\n");
    copyText(text).then(() => toast.show("Copied the error", { variant: "success", durationMs: 2000 }), () => toast.error("Could not copy."));
  };
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 10, gap: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
      <View style={{ gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{test.title}</Text>
          {test.status === "timedOut" ? <Badge colors={colors} color={colors.statusWarning} label="Timed out" /> : null}
          {test.duration !== undefined ? <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] }}>{formatDuration(test.duration)}</Text> : null}
        </View>
        <Text numberOfLines={2} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{testWhere(test)}</Text>
        {test.failedStep ? (
          <Text numberOfLines={2} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
            Failed at <Text style={{ color: colors.foreground }}>{test.failedStep}</Text>
          </Text>
        ) : null}
      </View>
      <View style={{ borderRadius: 4, backgroundColor: colors.surface1, padding: 8, gap: 6 }}>
        <Text selectable style={{ color: colors.foreground, fontFamily: mono(), fontSize: 11, lineHeight: 16 }}>
          {expanded ? message.trimEnd() : preview.text}
        </Text>
        {expanded && test.error?.snippet ? (
          <Text selectable style={{ color: colors.foregroundMuted, fontFamily: mono(), fontSize: 11, lineHeight: 16, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
            {test.error.snippet}
          </Text>
        ) : null}
        {preview.more || test.error?.snippet ? (
          <PressScale static accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} outerStyle={{ alignSelf: "flex-start" }}
            style={({ hovered }) => ({ flexDirection: "row", alignItems: "center", gap: 4, opacity: hovered ? 1 : 0.85 })}>
            <IconSwap swapKey={expanded ? "up" : "down"} size={12}><Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={12} color={colors.foregroundMuted} /></IconSwap>
            <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16, fontWeight: "600" }}>{expanded ? "Show less" : test.error?.snippet ? "Show all and the code" : "Show all"}</Text>
          </PressScale>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {KIND_ORDER.map((kind) => {
          const file = byKind.get(kind);
          if (!file) return null;
          return <ChipButton key={kind} colors={colors} icon={KIND_ICON[kind]} label={KIND_LABEL[kind]}
            onPress={() => (kind === "screenshot" ? actions.preview(test, file.index) : actions.open({ testId: test.id, index: file.index, path: file.attachment.path }, kind))} />;
        })}
        <ChipButton colors={colors} icon="Copy" label="Copy error" onPress={copy} />
      </View>
    </View>
  );
}

function ChipButton({ colors, icon, label, onPress }: { colors: Colors; icon: string; label: string; onPress(): void }) {
  return (
    <PressScale accessibilityRole="button" onPress={onPress}
      style={({ pressed, hovered }) => ({ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4, paddingStart: 7, paddingEnd: 9, borderRadius: 4,
        ...raised(colors), backgroundColor: pressed ? colors.surface1 : hovered ? colors.surface2 : colors.surface1 })}>
      <Icon name={icon} size={12} color={colors.foreground} />
      <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 16 }}>{label}</Text>
    </PressScale>
  );
}

// Whether the passed tests are shown, per run, kept for the app session.
const passedShown = new Map<string, boolean>();

// Every finished test in the order it ran. Passed ones fold into one row, so
// what needs a look stays near the top; failures are listed above, in full.
export function TestsSection({ colors, run, tally }: { colors: Colors; run: RunSnapshot; tally: Counts }) {
  const [shown, setShown] = useState(() => passedShown.get(run.id) ?? false);
  const toggle = () => {
    passedShown.set(run.id, !shown);
    setShown(!shown);
  };
  const finished = run.tests.filter((test) => test.status !== "running");
  const passes = (test: PulseTest) => verdict(test) === "passed" || verdict(test) === "flaky";
  const passed = finished.filter(passes);
  const others = finished.filter((test) => !passes(test));
  const toGo = Math.max(0, tally.total - tally.done - tally.running);
  const live = run.status === "running" || run.status === "starting";
  return (
    <Card colors={colors}>
      <SectionTitle colors={colors} icon="ListChecks" title="Tests" />
      {passed.length ? <PassedRow colors={colors} tests={passed} shown={shown} onPress={toggle} /> : null}
      {shown ? passed.map((test) => <TestRow key={test.id} colors={colors} test={test} />) : null}
      {others.map((test) => <TestRow key={test.id} colors={colors} test={test} />)}
      {toGo ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
          <View style={{ width: 16, paddingTop: 2, alignItems: "center" }}><WaitingDot color={colors.foregroundMuted} size={14} /></View>
          <Text style={{ flex: 1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] }}>
            {toGo} {live ? "to go" : "didn't run"}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

function PassedRow({ colors, tests, shown, onPress }: { colors: Colors; tests: PulseTest[]; shown: boolean; onPress(): void }) {
  const flaky = tests.filter((test) => verdict(test) === "flaky").length;
  const label = `${tests.length} passed${flaky ? `, ${flaky} flaky` : ""}`;
  const total = tests.reduce((sum, test) => sum + (test.duration ?? 0), 0);
  const chevron = shown ? "ChevronUp" : "ChevronDown";
  return (
    <PressableRow colors={colors} accessibilityRole="button" accessibilityState={{ expanded: shown }}
      accessibilityLabel={`${shown ? "Hide" : "Show"} ${label}`} onPress={onPress}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
      <View style={{ width: 16, paddingTop: 2, alignItems: "center" }}><Icon name="Check" size={14} color={colors.statusSuccess} /></View>
      <Text style={{ flex: 1, minWidth: 0, color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{label}</Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] }}>{formatDuration(total)}</Text>
      <View style={{ paddingTop: 2 }}>
        <IconSwap swapKey={chevron} size={14}><Icon name={chevron} size={14} color={colors.foregroundMuted} /></IconSwap>
      </View>
    </PressableRow>
  );
}

function TestIcon({ colors, test }: { colors: Colors; test: PulseTest }) {
  switch (verdict(test)) {
    case "passed": return <Icon name="Check" size={14} color={colors.statusSuccess} />;
    case "flaky": return <Icon name="TriangleAlert" size={14} color={colors.statusWarning} />;
    case "skipped": return <Icon name="CircleSlash" size={14} color={colors.foregroundMuted} />;
    case "stopped": return <Icon name="CircleStop" size={14} color={colors.statusWarning} />;
    default: return <Icon name={test.status === "timedOut" ? "Timer" : "X"} size={14} color={colors.statusDanger} />;
  }
}

function TestRow({ colors, test }: { colors: Colors; test: PulseTest }) {
  const narrow = useNarrow();
  const note = verdictNote(test);
  const flaky = verdict(test) === "flaky";
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: narrow ? 8 : 10, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
      <View style={{ width: 16, paddingTop: 2, alignItems: "center" }}><TestIcon colors={colors} test={test} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text style={{ color: test.status === "skipped" ? colors.foregroundMuted : colors.foreground, fontSize: 13, lineHeight: 18 }}>{test.title}</Text>
        {note ? <Text style={{ color: flaky ? colors.statusWarning : colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{note}</Text> : null}
      </View>
      {test.duration !== undefined && test.status !== "skipped" ? (
        <Text style={{ minWidth: 36, textAlign: "right", color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] }}>{formatDuration(test.duration)}</Text>
      ) : null}
    </View>
  );
}
