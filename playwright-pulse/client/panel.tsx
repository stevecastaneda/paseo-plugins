import { type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, ScrollView, Text, View } from "react-native";
import { openAttachment } from "../shared/rpc";
import type { RunSnapshot } from "../shared/run";
import { STATUS_TITLE, commandLine, counts, formatAgo, formatClock, formatDuration, isLive, runElapsed, type Counts } from "../shared/view";
import { mono } from "./mono";
import { IconSwap, Presence, StaggerRoot, nativeDriver } from "./motion";
import { NARROW_MAX, NarrowProvider } from "./narrow";
import { usePulse } from "./query";
import { ReporterBanner } from "./reporter-banner";
import { ScreenshotDialog, type ScreenshotRef } from "./screenshot";
import { Spinner } from "./spinner";
import { StopButton } from "./stop-button";
import { FailuresSection, RunningSection, TestsSection, type AttachmentActions } from "./tests";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

export function PulsePanel(props: PluginWorkspacePanelProps) {
  return <WorkspacePulse key={`${props.host.id}:${props.workspaceId}`} {...props} />;
}

function WorkspacePulse({ theme, workspaceId, host }: PluginWorkspacePanelProps) {
  const colors = theme.colors;
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const query = usePulse(host.id, workspaceId, directory);
  const result = query.data ?? null;
  const [narrow, setNarrow] = useState(false);
  return (
    <NarrowProvider value={narrow}>
      <ScrollView onLayout={(event) => setNarrow(event.nativeEvent.layout.width <= NARROW_MAX)}
        style={{ flex: 1, backgroundColor: colors.surface0 }} contentContainerStyle={{ paddingBottom: 16 }}>
        {query.isPending && directory ? <ActivityIndicator color={colors.foregroundMuted} accessibilityLabel="Loading test run" style={{ padding: 12 }} /> : null}
        {query.error ? (
          <Text accessibilityRole="alert" selectable style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 18, padding: 12 }}>
            Could not read the test run: {query.error.message}
          </Text>
        ) : null}
        <ReporterBanner colors={colors} status={result?.reporter ?? null} />
        <Presence show={Boolean(result && !result.run)}>{result && !result.run ? <EmptyState colors={colors} file={result.file} reporterPath={result.reporter.path} /> : null}</Presence>
        {/* Keyed by run: a new run starts with fresh folds and dialogs. */}
        {result?.run ? <RunView key={result.run.id} colors={colors} run={result.run} workspaceId={workspaceId} workspaceDirectory={result.root} /> : null}
      </ScrollView>
    </NarrowProvider>
  );
}

function EmptyState({ colors, file, reporterPath }: { colors: Colors; file: string; reporterPath: string }) {
  const home = reporterPath.match(/^\/(?:Users|home)\/[^/]+/)?.[0];
  const shownPath = home ? `~${reporterPath.slice(home.length)}` : reporterPath;
  return (
    <View style={{ padding: 12, paddingTop: 20, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="Activity" size={18} color={colors.foregroundMuted} />
        <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: "500" }}>
          No test runs yet
        </Text>
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
        The next Playwright run in this worktree shows up here live: each test as it runs, its current step, and any failure with its screenshot and trace. Add the Pulse reporter to <Text style={{ color: colors.foreground }}>playwright.config.ts</Text>:
      </Text>
      <View style={{ backgroundColor: colors.surface1, borderRadius: 6, padding: 10 }}>
        <Text selectable style={{ color: colors.foreground, fontFamily: mono(), fontSize: 12, lineHeight: 18 }}>
          {`const pulse = join(homedir(), "${shownPath.replace(/^~\//, "")}");\nconst ours = (path: string) => {\n  try { return readFileSync(path, "utf8")\n    .startsWith("// Written by the playwright-pulse"); }\n  catch { return false; }\n};\n\nreporter: [\n  ["list"],\n  ...(!process.env.CI && ours(pulse)\n    ? [[pulse] as const] : []),\n],`}
        </Text>
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
        A <Text style={{ color: colors.foreground, fontFamily: mono(), fontSize: 11 }}>--reporter</Text> flag replaces the config's reporters, so leave it off. The README has the full snippet. Runs are kept outside the repo, in <Text selectable style={{ color: colors.foreground }}>{file}</Text>.
      </Text>
    </View>
  );
}

// Re-renders on an interval so clocks keep counting between polls.
function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function RunView({ colors, run, workspaceId, workspaceDirectory }: { colors: Colors; run: RunSnapshot; workspaceId: string; workspaceDirectory: string }) {
  const live = isLive(run);
  const now = useNow(live ? 1000 : 30_000);
  const tally = counts(run);
  const [shot, setShot] = useState<ScreenshotRef | null>(null);
  const actions = useAttachmentActions(run, workspaceId, workspaceDirectory, setShot);
  const running = run.tests.filter((test) => test.status === "running");
  // A new run or a retry replaces the screenshot on show; close it then.
  const shotGone = shot !== null && (run.id !== shot.runId || run.tests.find((test) => test.id === shot.testId)?.attachments[shot.index]?.path !== shot.path);
  useEffect(() => {
    if (shotGone) setShot(null);
  }, [shotGone]);
  return (
    <StaggerRoot>
      <Presence show order={0}>
        <Header colors={colors} run={run} tally={tally} now={now} workspaceId={workspaceId} workspaceDirectory={workspaceDirectory} />
      </Presence>
      <Presence show={run.status === "starting"} order={1}>
        {run.status === "starting" ? <StartingUp colors={colors} run={run} now={now} /> : null}
      </Presence>
      <Presence show={run.errors.length > 0} order={1}>
        {run.errors.length ? <RunErrors colors={colors} errors={run.errors} /> : null}
      </Presence>
      <Presence show={running.length > 0} order={2}>
        {running.length ? <RunningSection colors={colors} tests={running} now={now} /> : null}
      </Presence>
      <Presence show={tally.failed > 0} order={3}>
        {tally.failed ? <FailuresSection colors={colors} run={run} actions={actions} /> : null}
      </Presence>
      <Presence show={tally.done > 0 || tally.total > tally.running} order={4}>
        <TestsSection colors={colors} run={run} tally={tally} />
      </Presence>
      <ScreenshotDialog colors={colors} shot={shot} workspaceId={workspaceId} workspaceDirectory={workspaceDirectory}
        onClose={() => setShot(null)} onOpenOnHost={(target) => actions.open(target, "screenshot")} />
    </StaggerRoot>
  );
}

function useAttachmentActions(run: RunSnapshot, workspaceId: string, workspaceDirectory: string, setShot: (shot: ScreenshotRef) => void): AttachmentActions {
  const open = useRpc(openAttachment);
  const toast = useToast();
  return {
    preview(test, index) {
      const attachment = test.attachments[index];
      setShot({ runId: run.id, testId: test.id, index, title: test.title, path: attachment.path });
    },
    open({ testId, index, path }, kind) {
      if (kind === "trace") toast.show("Opening the trace viewer…", { durationMs: 2500 });
      open({ workspaceId, workspaceDirectory, runId: run.id, testId, index, path })
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not open it."));
    },
  };
}

const STATUS_ICON: Record<string, string> = { passed: "CircleCheck", failed: "CircleX", timedout: "Timer", interrupted: "CircleStop" };

function statusColor(colors: Colors, run: RunSnapshot, tally: Counts): string {
  if (isLive(run)) return tally.failed ? colors.statusDanger : colors.foreground;
  if (run.status === "passed") return colors.statusSuccess;
  if (run.status === "interrupted") return colors.statusWarning;
  return colors.statusDanger;
}

// The run at a glance: its state and clock, the command, and the bar.
function Header({ colors, run, tally, now, workspaceId, workspaceDirectory }: { colors: Colors; run: RunSnapshot; tally: Counts; now: number; workspaceId: string; workspaceDirectory: string }) {
  const live = isLive(run);
  const color = statusColor(colors, run, tally);
  // A live run that already has a failure says so in its title, in red.
  const title = live && tally.failed ? `${STATUS_TITLE[run.status]}, ${tally.failed} failed` : STATUS_TITLE[run.status];
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <IconSwap swapKey={live ? "live" : run.status} size={16}>
            {live ? <Spinner color={tally.failed ? colors.statusDanger : colors.accent} size={16} />
              : <Icon name={STATUS_ICON[run.status] ?? "Circle"} size={16} color={color} />}
          </IconSwap>
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={{ flex: 1, color, fontSize: 15, lineHeight: 21, fontWeight: "600" }}>
            {title}
          </Text>
          <Text accessibilityLabel={live ? "Elapsed" : "Took"} style={{ color: live ? colors.foreground : colors.foregroundMuted, fontSize: 13, lineHeight: 21, fontWeight: live ? "600" : "400", fontVariant: ["tabular-nums"] }}>
            {live ? formatClock(runElapsed(run, now)) : formatDuration(runElapsed(run, now))}
          </Text>
          {live ? <StopButton colors={colors} runId={run.id} workspaceId={workspaceId} workspaceDirectory={workspaceDirectory} /> : null}
        </View>
        <Text selectable numberOfLines={2} style={{ color: colors.foregroundMuted, fontFamily: mono(), fontSize: 11, lineHeight: 16 }}>
          {commandLine(run.args)}
        </Text>
        {!live ? (
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
            {run.status === "interrupted" && !run.endedAt ? "Stopped" : "Ended"} {formatAgo(run.endedAt ?? run.updatedAt, now)}
            {run.projects.length ? ` · ${run.projects.join(", ")}` : ""}
          </Text>
        ) : run.projects.length ? (
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{run.projects.join(", ")}</Text>
        ) : null}
      </View>
      {run.status !== "starting" && tally.total > 0 ? <ProgressBar colors={colors} tally={tally} live={live} /> : null}
    </View>
  );
}

// One segment per outcome, in the order people scan: passed, failed, skipped,
// stopped, then the test running now and what's still to go.
function ProgressBar({ colors, tally, live }: { colors: Colors; tally: Counts; live: boolean }) {
  const toGo = Math.max(0, tally.total - tally.done - tally.running);
  const segments = [
    { key: "passed", flex: tally.passed, color: colors.statusSuccess },
    { key: "failed", flex: tally.failed, color: colors.statusDanger },
    { key: "skipped", flex: tally.skipped, color: colors.foregroundMuted },
    { key: "stopped", flex: tally.stopped, color: colors.statusWarning },
    { key: "running", flex: live ? tally.running : 0, color: colors.accent, shimmer: true },
    { key: "togo", flex: toGo, color: colors.surface2 },
  ].filter((segment) => segment.flex > 0);
  // The bar and its counts read as one group: 6 within, 12 to the text above.
  return (
    <View style={{ gap: 6 }}>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: tally.total, now: tally.done }}
        style={{ flexDirection: "row", gap: 2, height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: segments.length ? "transparent" : colors.surface2 }}>
        {segments.map((segment) => (
          <View key={segment.key} style={{ flex: segment.flex, backgroundColor: segment.color, opacity: segment.shimmer ? 0.5 : 1, overflow: "hidden" }}>
            {segment.shimmer ? <Shimmer /> : null}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 4 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17, fontVariant: ["tabular-nums"] }}>
          <Text style={{ color: colors.foreground, fontWeight: "600" }}>{tally.done}</Text> of {tally.total}
        </Text>
        <Tally colors={colors} color={colors.statusSuccess} count={tally.passed} label="passed" />
        {tally.failed ? <Tally colors={colors} color={colors.statusDanger} count={tally.failed} label="failed" /> : null}
        {tally.flaky ? <Tally colors={colors} color={colors.statusWarning} count={tally.flaky} label="flaky" /> : null}
        {tally.skipped ? <Tally colors={colors} color={colors.foregroundMuted} count={tally.skipped} label="skipped" /> : null}
        {tally.stopped ? <Tally colors={colors} color={colors.statusWarning} count={tally.stopped} label="stopped" /> : null}
      </View>
    </View>
  );
}

function Tally({ colors, color, count, label }: { colors: Colors; color: string; count: number; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17, fontVariant: ["tabular-nums"] }}>
        <Text style={{ color: colors.foreground }}>{count}</Text> {label}
      </Text>
    </View>
  );
}

// A soft pulse on the running segment.
function Shimmer() {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: 900, useNativeDriver: nativeDriver() }),
      Animated.timing(value, { toValue: 0, duration: 900, useNativeDriver: nativeDriver() }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [value]);
  return <Animated.View style={{ flex: 1, backgroundColor: "#ffffff", opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] }) }} />;
}

// Before the first test: Playwright is booting web servers and running global
// setup, which can take minutes. Say so, so the wait doesn't look stuck.
function StartingUp({ colors, run, now }: { colors: Colors; run: RunSnapshot; now: number }) {
  const waited = now - Date.parse(run.startedAt);
  return (
    <View style={{ flexDirection: "row", gap: 10, margin: 12, marginBottom: 0, padding: 10, borderRadius: 6, backgroundColor: colors.surface1 }}>
      <View style={{ paddingTop: 2 }}><Icon name="Server" size={14} color={colors.foregroundMuted} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>Getting ready</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          Starting web servers and running global setup. Tests start once they're ready{waited > 60_000 ? "; the first boot of a worktree is the slowest" : ""}.
        </Text>
      </View>
    </View>
  );
}

// Errors outside any test, like a web server that never came up.
function RunErrors({ colors, errors }: { colors: Colors; errors: string[] }) {
  return (
    <View accessibilityRole="alert" style={{ margin: 12, marginBottom: 0, borderWidth: 1, borderColor: colors.statusDanger, borderRadius: 6, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8 }}>
        <Icon name="OctagonAlert" size={14} color={colors.statusDanger} />
        <Text accessibilityRole="header" style={{ color: colors.statusDanger, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>
          {errors.length === 1 ? "The run hit an error" : `The run hit ${errors.length} errors`}
        </Text>
      </View>
      {errors.map((error, index) => (
        <Text key={index} selectable numberOfLines={12} style={{ paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border, color: colors.foreground, fontFamily: mono(), fontSize: 11, lineHeight: 16 }}>
          {error}
        </Text>
      ))}
    </View>
  );
}
