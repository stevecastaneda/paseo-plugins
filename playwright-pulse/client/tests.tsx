import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import React, { useRef, useState } from "react";
import { Text, View } from "react-native";
import type { PulseTest, RunSnapshot } from "../shared/run";
import { folders, assignSlots, attachmentKind, isLive, slowest, type Folder, errorPreview, failureMessage, formatClock, formatDuration, isFailure, testWhere, timeoutShare, runningSlotCount, shownFailure, stepFailure, verdict, verdictNote, type AttachmentKind, type Counts } from "../shared/view";
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

// The tests running now, each with its live step and the steps just before
// it. The card keeps its height for the whole run: one row per worker, each
// row a fixed size, so whatever is below it holds still while you read.
export function RunningSection({ colors, run, now }: { colors: Colors; run: RunSnapshot; now: number }) {
  const running = run.tests.filter((test) => test.status === "running");
  const slots = useRef<(string | null)[]>([]);
  slots.current = assignSlots(slots.current, running.map((test) => test.id), runningSlotCount(run, running.length));
  return (
    <Card colors={colors}>
      <SectionTitle colors={colors} icon="Play" title="Running now" />
      {slots.current.map((id, index) => (
        <RunningTest key={index} colors={colors} test={running.find((test) => test.id === id) ?? null} now={now} />
      ))}
    </Card>
  );
}

const TRAIL_ROWS = 3;

// A row in the running card, or the same shape held empty between tests.
function RunningTest({ colors, test, now }: { colors: Colors; test: PulseTest | null; now: number }) {
  const elapsed = test?.startedAt ? now - Date.parse(test.startedAt) : 0;
  const share = test ? timeoutShare(test, now) : null;
  const stepElapsed = test?.step ? now - Date.parse(test.step.startedAt) : 0;
  const trail = [...(test?.recentSteps ?? [])].reverse().slice(0, TRAIL_ROWS);
  return (
    <View style={{ paddingHorizontal: 10, paddingTop: 10, paddingBottom: 12, gap: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface1 }}>
      <View style={{ gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <Text numberOfLines={2} style={{ flex: 1, minHeight: 36, color: test ? colors.foreground : colors.foregroundMuted, fontSize: 13, lineHeight: 18, fontWeight: test ? "600" : "400" }}>
            {test ? test.title : "Waiting for the next test"}
          </Text>
          {test?.retry ? <Badge colors={colors} color={colors.statusWarning} label={`Retry ${test.retry}`} /> : null}
          {test ? <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] }}>{formatClock(elapsed)}</Text> : null}
        </View>
        {/* The describe blocks give way first, so the file and line stay readable. */}
        <View style={{ flexDirection: "row", minWidth: 0 }}>
          {test?.titlePath.length ? (
            <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{test.titlePath.join(" › ")}{" › "}</Text>
          ) : null}
          <Text numberOfLines={1} style={{ flexShrink: 0, maxWidth: "100%", color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{test ? `${test.file}:${test.line}` : " "}</Text>
        </View>
      </View>
      <View style={{ borderRadius: 4, backgroundColor: colors.surface0, ...raised(colors), overflow: "hidden" }}>
        <StepLine colors={colors} live
          icon={test ? <Spinner color={colors.accent} size={12} /> : <WaitingDot color={colors.foregroundMuted} size={12} />}
          title={test ? (test.step?.title ?? "Setting up") : ""} subtitle={test?.step?.subtitle}
          context={test?.step?.context} time={stepElapsed >= SLOW_STEP_MS ? formatClock(stepElapsed) : undefined} />
        {Array.from({ length: TRAIL_ROWS }, (_, index) => {
          const step = trail[index];
          return step ? (
            <StepLine key={index} colors={colors} faded={index + 1}
              icon={<Icon name={step.failed ? "X" : "Check"} size={12} color={step.failed ? colors.statusDanger : colors.statusSuccess} />}
              title={step.title} subtitle={step.subtitle} time={formatDuration(step.duration)} />
          ) : <StepLine key={index} colors={colors} hidden icon={null} title=" " />;
        })}
      </View>
      <TimeoutBar colors={colors} share={share ?? 0} timeout={test?.timeout ?? 0} hidden={share === null} />
    </View>
  );
}

// One step: icon, title, the locator or URL it acted on, and its time. The
// live step always takes two lines and its "in" line, so a long locator or a
// step with no context doesn't change the row's height.
function StepLine({ colors, icon, title, subtitle, context, time, live, faded = 0, hidden }: {
  colors: Colors; icon: React.ReactNode; title: string; subtitle?: string; context?: string; time?: string; live?: boolean; faded?: number; hidden?: boolean;
}) {
  return (
    <View aria-hidden={hidden} style={{ flexDirection: "row", gap: 8, paddingHorizontal: 8, paddingVertical: 6, opacity: hidden ? 0 : 1 - faded * 0.18,
      borderTopWidth: live ? 0 : 1, borderTopColor: colors.border }}>
      <View style={{ width: 12, paddingTop: 3, alignItems: "center" }}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={live ? 2 : 1} style={{ minHeight: live ? 36 : undefined, color: live ? colors.foreground : colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
          <Text style={{ fontWeight: live ? "600" : "400" }}>{title}</Text>
          {subtitle ? <Text style={{ fontFamily: mono(), fontSize: 11, color: colors.foregroundMuted }}>{"  "}{subtitle}</Text> : null}
        </Text>
        {live ? <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>{context ? `in ${context}` : " "}</Text> : null}
      </View>
      {time ? <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 18, fontVariant: ["tabular-nums"] }}>{time}</Text> : null}
    </View>
  );
}

// How much of its timeout the test has used. Amber past three quarters.
function TimeoutBar({ colors, share, timeout, hidden }: { colors: Colors; share: number; timeout: number; hidden?: boolean }) {
  const late = share >= 0.75;
  return (
    <View aria-hidden={hidden} style={{ flexDirection: "row", alignItems: "center", gap: 8, opacity: hidden ? 0 : 1 }}>
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
// and the files Playwright kept. One shows at a time, so a long list doesn't
// bury the running tests; the arrows step through them.
export function FailuresSection({ colors, run, actions }: { colors: Colors; run: RunSnapshot; actions: AttachmentActions }) {
  const failures = run.tests.filter(isFailure);
  const ids = failures.map((test) => test.id);
  const [picked, setPicked] = useState<string | null>(null);
  const index = shownFailure(ids, picked);
  const shown = failures[index];
  const step = (delta: 1 | -1) => setPicked(stepFailure(ids, shown?.id ?? null, delta));
  return (
    <Card colors={colors} tone="danger">
      <SectionTitle colors={colors} icon="CircleX" title={failures.length === 1 ? "1 failure" : `${failures.length} failures`} color={colors.statusDanger}
        style={failures.length > 1 ? { paddingVertical: 5 } : undefined}>
        {failures.length > 1 ? (
          // One small control, not three: the arrows and count share a shape,
          // inset to the same edge as the text below.
          // The arrows' hover sits inset, with room before the count.
          <View style={{ marginStart: "auto", flexDirection: "row", alignItems: "center", height: 24, padding: 2, borderRadius: 4, ...raised(colors), backgroundColor: colors.surface1 }}>
            <PagerButton colors={colors} icon="ChevronLeft" label="Previous failure" onPress={() => step(-1)} />
            <Text accessibilityLiveRegion="polite" style={{ paddingHorizontal: 6, color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"] }}>
              {index + 1} of {failures.length}
            </Text>
            <PagerButton colors={colors} icon="ChevronRight" label="Next failure" onPress={() => step(1)} />
          </View>
        ) : null}
      </SectionTitle>
      {shown ? <Failure key={shown.id} colors={colors} test={shown} actions={actions} /> : null}
    </Card>
  );
}

function PagerButton({ colors, icon, label, onPress }: { colors: Colors; icon: string; label: string; onPress(): void }) {
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed, hovered }) => ({ width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 2,
        backgroundColor: pressed || hovered ? colors.surface2 : "transparent" })}>
      <Icon name={icon} size={14} color={colors.foreground} />
    </PressScale>
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

// The slowest tests so far, each against its timeout: the ones to speed up,
// and the ones at risk of timing out on a slower machine.
export function SlowestList({ colors, run }: { colors: Colors; run: RunSnapshot }) {
  return (
    <View>
      {slowest(run).map((test, index) => {
        const share = test.timeout ? Math.min(1, (test.duration ?? 0) / test.timeout) : null;
        return (
          <View key={test.id} style={{ paddingHorizontal: 10, paddingVertical: 8, gap: 4, borderTopWidth: index ? 1 : 0, borderTopColor: colors.border }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{test.title}</Text>
              <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] }}>{formatDuration(test.duration ?? 0)}</Text>
            </View>
            <Text numberOfLines={2} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{test.file}:{test.line}</Text>
            {share !== null ? <TimeoutBar colors={colors} share={share} timeout={test.timeout} /> : null}
          </View>
        );
      })}
    </View>
  );
}

// Which folders are open, per run, kept for the app session.
const openFolders = new Map<string, Set<string>>();

// The suite by folder (a folder of specs), in the order it runs: how far each
// has got and whether anything in it failed. Press a folder for its tests.
export function FoldersList({ colors, run }: { colors: Colors; run: RunSnapshot }) {
  const list = folders(run);
  const [open, setOpen] = useState(() => openFolders.get(run.id) ?? new Set<string>());
  const toggle = (name: string) => {
    const next = new Set(open);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    openFolders.set(run.id, next);
    setOpen(next);
  };
  const live = isLive(run);
  return (
    <View>
      {list.map((folder, index) => (
        <React.Fragment key={folder.name}>
          <FolderRow colors={colors} folder={folder} live={live} first={index === 0} open={open.has(folder.name)} onPress={() => toggle(folder.name)} />
          {open.has(folder.name) ? (
            <View style={{ backgroundColor: colors.surface1 }}>
              {folder.tests.map((test) => <TestRow key={test.id} colors={colors} test={test} />)}
              {folder.total > folder.tests.length ? (
                <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ width: 16, paddingTop: 2, alignItems: "center" }}><WaitingDot color={colors.foregroundMuted} size={14} /></View>
                  <Text style={{ flex: 1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] }}>
                    {folder.total - folder.tests.length} {live ? "to go" : "didn't run"}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </React.Fragment>
      ))}
    </View>
  );
}

function FolderIcon({ colors, folder, live }: { colors: Colors; folder: Folder; live: boolean }) {
  if (folder.failed) return <Icon name="X" size={14} color={colors.statusDanger} />;
  if (folder.running) return <Spinner color={colors.accent} size={14} />;
  if (folder.done >= folder.total) return <Icon name="Check" size={14} color={colors.statusSuccess} />;
  if (!live) return <Icon name="CircleStop" size={14} color={colors.statusWarning} />;
  return <WaitingDot color={colors.foregroundMuted} size={14} />;
}

function FolderRow({ colors, folder, live, first, open, onPress }: { colors: Colors; folder: Folder; live: boolean; first: boolean; open: boolean; onPress(): void }) {
  const notes = [folder.failed ? `${folder.failed} failed` : null, folder.flaky ? `${folder.flaky} flaky` : null, folder.skipped ? `${folder.skipped} skipped` : null].filter(Boolean);
  const segments = [
    { key: "passed", flex: folder.passed, color: colors.statusSuccess },
    { key: "failed", flex: folder.failed, color: colors.statusDanger },
    { key: "skipped", flex: folder.skipped, color: colors.foregroundMuted },
    { key: "stopped", flex: folder.stopped, color: colors.statusWarning },
    { key: "togo", flex: Math.max(0, folder.total - folder.done), color: colors.surface2 },
  ].filter((segment) => segment.flex > 0);
  const chevron = open ? "ChevronUp" : "ChevronDown";
  return (
    <PressableRow colors={colors} accessibilityRole="button" accessibilityState={{ expanded: open }}
      accessibilityLabel={`${folder.name}: ${folder.done} of ${folder.total} done${notes.length ? `, ${notes.join(", ")}` : ""}`} onPress={onPress}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: first ? 0 : 1, borderTopColor: colors.border }}>
      <View style={{ width: 16, paddingTop: 2, alignItems: "center" }}><FolderIcon colors={colors} folder={folder} live={live} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{folder.name}</Text>
          {notes.length ? <Text style={{ color: folder.failed ? colors.statusDanger : colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{notes.join(" · ")}</Text> : null}
          <Text style={{ minWidth: 40, textAlign: "right", color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] }}>{folder.done}/{folder.total}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 1, height: 3, borderRadius: 2, overflow: "hidden" }}>
          {segments.map((segment) => <View key={segment.key} style={{ flex: segment.flex, backgroundColor: segment.color }} />)}
        </View>
      </View>
      <View style={{ paddingTop: 2 }}>
        <IconSwap swapKey={chevron} size={14}><Icon name={chevron} size={14} color={colors.foregroundMuted} /></IconSwap>
      </View>
    </PressableRow>
  );
}

function TestIcon({ colors, test }: { colors: Colors; test: PulseTest }) {
  switch (verdict(test)) {
    case "running": return <Spinner color={colors.accent} size={14} />;
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
