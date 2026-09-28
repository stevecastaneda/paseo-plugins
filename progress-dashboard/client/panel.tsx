import { type PluginWorkspacePanelProps, useWorkspace } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { DeliverablesSection } from "./deliverables";
import { LauncherBanner, SkillBanner } from "./launcher";
import { AnsweredQuestionsSection, QuestionsSection } from "./questions";
import { Spinner, StalledPulse } from "./spinner";
import { IconSwap, Presence, StaggerRoot, nativeDriver } from "./motion";
import { raised } from "./surfaces";
import { When } from "./when";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Platform, ScrollView, Text, View } from "react-native";
import type { Activity, Dashboard, FileIssue, ProgressSegment, StuckItem, Ticket } from "../shared/dashboard";
import { PROGRESS_FILE, type TicketStatus } from "../shared/events";
import { formatHours, formatMinutes, minutesSince } from "../shared/format";
import { useDashboard } from "./dashboard-query";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

const STATUS_LABEL: Record<TicketStatus, string> = {
  not_started: "Not started",
  working: "Working",
  blocked: "Blocked",
  done: "Done",
  skipped: "Skipped",
};

const mono = () => (Platform.OS === "ios" ? "Menlo" : "monospace");

export function ProgressPanel(props: PluginWorkspacePanelProps) {
  return <WorkspaceProgress key={`${props.host.id}:${props.workspaceId}`} {...props} />;
}

function WorkspaceProgress({ theme, workspaceId, host, layout, navigation }: PluginWorkspacePanelProps) {
  const colors = theme.colors;
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const query = useDashboard(host.id, workspaceId, directory);
  const result = query.data ?? null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface0 }} contentContainerStyle={{ paddingBottom: 16 }}>
      {query.isPending ? <ActivityIndicator color={colors.foregroundMuted} accessibilityLabel="Loading progress" style={{ padding: 12 }} /> : null}
      {query.error ? (
        <Text accessibilityRole="alert" selectable style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 18, padding: 12 }}>
          Could not read progress: {query.error.message}
        </Text>
      ) : null}
      <LauncherBanner colors={colors} host={host} />
      <SkillBanner colors={colors} host={host} />
      {result && !result.configured ? <EmptyState colors={colors} /> : null}
      {result?.configured ? <DashboardView colors={colors} dashboard={result.dashboard} scope={`${host.id}:${workspaceId}`} compact={layout.compact}
        workspaceId={workspaceId} workspaceDirectory={directory ?? ""} navigation={navigation} /> : null}
    </ScrollView>
  );
}

function EmptyState({ colors }: { colors: Colors }) {
  return (
    <View style={{ padding: 12, paddingTop: 20, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="ListChecks" size={18} color={colors.foregroundMuted} />
        <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: "500" }}>
          No progress recorded yet
        </Text>
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
        An agent working in this worktree records progress with the <Text style={{ color: colors.foreground }}>paseo-progress</Text> command. It shows up here as soon as the first run starts.
      </Text>
      <View style={{ backgroundColor: colors.surface1, borderRadius: 6, padding: 10 }}>
        <Text selectable style={{ color: colors.foreground, fontFamily: mono(), fontSize: 12, lineHeight: 18 }}>
          {`paseo-progress start "Build the export feature"\npaseo-progress ticket add "Ticket 01: Export button" --estimate 60`}
        </Text>
      </View>
    </View>
  );
}

// Re-renders on an interval so "x min ago" keeps counting between polls.
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const WIDE_MIN = 760;

function DashboardView({ colors, dashboard, scope, compact, workspaceId, workspaceDirectory, navigation }: {
  colors: Colors;
  dashboard: Dashboard;
  scope: string;
  compact: boolean;
  workspaceId: string;
  workspaceDirectory: string;
  navigation: PluginWorkspacePanelProps["navigation"];
}) {
  const now = useNow(15_000);
  const live = !dashboard.stale;
  // Two columns when opened as a wide tab; one in the narrow Explorer pane.
  const [wide, setWide] = useState(false);
  return (
    <StaggerRoot>
      <Presence show order={0}>
      <View style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 15, lineHeight: 21, fontWeight: "600" }}>
          {dashboard.run?.title ?? "Progress"}
        </Text>
        {dashboard.run?.subtitle ? (
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{dashboard.run.subtitle}</Text>
        ) : null}
        {dashboard.headline.length ? (
          <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 19 }}>
            {dashboard.headline.map((part, index) => (
              <Text key={part.text} style={part.tone === "danger" ? { color: colors.statusDanger } : undefined}>
                {index ? ", " : ""}{part.text}
              </Text>
            ))}
          </Text>
        ) : null}
        {dashboard.ticker ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <IconSwap swapKey={live ? "live" : "stale"} size={12}>{live ? <Spinner color={colors.accent} /> : <StalledPulse color={colors.statusWarning} />}</IconSwap>
            <Text accessibilityLiveRegion="polite" style={{ flex: 1, color: colors.foreground, fontSize: 12, lineHeight: 18 }}>{dashboard.ticker.text}</Text>
          </View>
        ) : null}
        {dashboard.updatedAt ? (
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
            Last updated <When colors={colors} iso={dashboard.updatedAt} now={now} />
          </Text>
        ) : null}
      </View>
      </Presence>
      <Presence show={Boolean(dashboard.stale && dashboard.updatedAt)} order={1}>{dashboard.stale && dashboard.updatedAt ? (
        <View accessibilityRole="alert" style={{ flexDirection: "row", gap: 8, margin: 12, marginBottom: 0, padding: 10, borderWidth: 1, borderColor: colors.statusWarning, borderRadius: 6 }}>
          {/* Optical: centers the 14px icon on the first 18px line. */}
          <View style={{ paddingTop: 2 }}><Icon name="TriangleAlert" size={14} color={colors.statusWarning} /></View>
          <Text style={{ flex: 1, color: colors.statusWarning, fontSize: 12, lineHeight: 18 }}>
            Possibly stale. No update for {formatMinutes(minutesSince(dashboard.updatedAt, now))}. The work may have stopped, so working items show a warning until the next update.
          </Text>
        </View>
      ) : null}</Presence>
      <Presence show={Boolean(dashboard.issues.length)} order={1}>{dashboard.issues.length ? <IssuesNotice colors={colors} issues={dashboard.issues} /> : null}</Presence>
      <Presence show={Boolean(dashboard.progress.totalMin > 0)} order={2}>{dashboard.progress.totalMin > 0 ? <ProgressBar colors={colors} progress={dashboard.progress} live={live} /> : null}</Presence>
      <View onLayout={(event) => setWide(event.nativeEvent.layout.width >= WIDE_MIN)}
        style={{ flexDirection: wide ? "row" : "column", alignItems: "flex-start" }}>
        <View style={{ flex: wide ? 3 : undefined, alignSelf: "stretch", minWidth: 0 }}>
          <Presence show={dashboard.questions.open.length > 0} order={3}>{dashboard.questions.open.length ? (
            <QuestionsSection colors={colors} questions={dashboard.questions.open} scope={scope} now={now} compact={compact || !wide} />
          ) : null}</Presence>
          <Presence show={Boolean(dashboard.stuck.length)} order={3}>{dashboard.stuck.length ? <StuckSection colors={colors} items={dashboard.stuck} now={now} /> : null}</Presence>
          <Presence show order={4}>
          <Card colors={colors} title={`${dashboard.run?.itemLabel ?? "Ticket"}s`}>
            {dashboard.tickets.length === 0 ? (
              <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                No {(dashboard.run?.itemLabel ?? "ticket").toLowerCase()}s yet.
              </Text>
            ) : (
              dashboard.tickets.map((ticket) => <TicketRow key={ticket.id} colors={colors} ticket={ticket} live={live} now={now} />)
            )}
          </Card>
          </Presence>
          <Presence show={dashboard.questions.answered.length > 0} order={5}>{dashboard.questions.answered.length ? (
            <AnsweredQuestionsSection colors={colors} questions={dashboard.questions.answered} scope={scope} now={now} />
          ) : null}</Presence>
        </View>
        <View style={{ flex: wide ? 2 : undefined, alignSelf: "stretch", minWidth: 0 }}>
          <Presence show={dashboard.deliverables.length > 0} order={5}>{dashboard.deliverables.length ? (
            <DeliverablesSection colors={colors} deliverables={dashboard.deliverables} workspaceId={workspaceId}
              workspaceDirectory={workspaceDirectory} navigation={navigation} />
          ) : null}</Presence>
          <Presence show={Boolean(dashboard.activity.length)} order={6}>{dashboard.activity.length ? <ActivitySection colors={colors} activity={dashboard.activity} now={now} /> : null}</Presence>
        </View>
      </View>
    </StaggerRoot>
  );
}

function ActivitySection({ colors, activity, now }: { colors: Colors; activity: Activity[]; now: number }) {
  return (
    <View style={{ margin: 12, marginBottom: 0, ...raised(colors), borderRadius: 6, overflow: "hidden" }}>
      <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600", paddingHorizontal: 10, paddingVertical: 8 }}>
        Activity
      </Text>
      {activity.map((entry) => (
        <View key={entry.id} style={{ paddingHorizontal: 10, paddingVertical: 8, gap: 1, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text selectable style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{entry.text}</Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
            <When colors={colors} iso={entry.at} now={now} />
          </Text>
        </View>
      ))}
    </View>
  );
}

// Small and non-blocking: the rest of the dashboard still renders.
function IssuesNotice({ colors, issues }: { colors: Colors; issues: FileIssue[] }) {
  const shown = issues.slice(0, 5);
  return (
    <View style={{ flexDirection: "row", gap: 8, margin: 12, marginBottom: 0, padding: 8, borderRadius: 6, backgroundColor: colors.surface1 }}>
      <View style={{ paddingTop: 1.5 }}><Icon name="FileWarning" size={14} color={colors.statusWarning} /></View>
      <Text selectable style={{ flex: 1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
        Skipped {issues.length === 1 ? "1 line" : `${issues.length} lines`} in {PROGRESS_FILE}:{" "}
        {shown.map((issue) => `line ${issue.line} (${issue.reason})`).join(", ")}
        {issues.length > shown.length ? `, and ${issues.length - shown.length} more` : ""}.
      </Text>
    </View>
  );
}

function Card({ colors, title, children }: { colors: Colors; title: string; children: React.ReactNode }) {
  return (
    <View style={{ margin: 12, marginBottom: 0, ...raised(colors), borderRadius: 6, overflow: "hidden" }}>
      <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600", paddingHorizontal: 10, paddingVertical: 8 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function ProgressBar({ colors, progress, live }: { colors: Colors; progress: Dashboard["progress"]; live: boolean }) {
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={{ flex: 1, color: colors.foregroundMuted, fontSize: 13, lineHeight: 18 }}>
          <Text style={{ color: colors.foreground, fontWeight: "600" }}>{progress.percent}%</Text> of estimated work done
        </Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
          {formatHours(progress.doneMin)} of {formatHours(progress.totalMin)}
        </Text>
      </View>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress.percent }}
        style={{ flexDirection: "row", gap: 2, height: 8, borderRadius: 4, overflow: "hidden" }}>
        {progress.segments.map((segment) => (
          <Segment key={segment.id} colors={colors} segment={segment} live={live} />
        ))}
      </View>
    </View>
  );
}

function Segment({ colors, segment, live }: { colors: Colors; segment: ProgressSegment; live: boolean }) {
  const working = segment.status === "working";
  const color = segment.status === "done" ? colors.accent
    : working ? colors.accent
    : segment.status === "blocked" ? colors.statusDanger
    : colors.surface2;
  return (
    <View style={{ flex: segment.estimateMin, backgroundColor: color, opacity: working ? 0.45 : 1, overflow: "hidden" }}>
      {working && live ? <Shimmer /> : null}
    </View>
  );
}

// A soft pulse on the working segment. Stops when the dashboard is stale so a
// stalled run never looks live.
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
  return <Animated.View style={{ flex: 1, backgroundColor: "#ffffff", opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] }) }} />;
}


function StuckSection({ colors, items, now }: { colors: Colors; items: StuckItem[]; now: number }) {
  return (
    <View style={{ margin: 12, marginBottom: 0, borderWidth: 1, borderColor: colors.statusDanger, borderRadius: 6, overflow: "hidden" }}>
      <Text accessibilityRole="header" style={{ color: colors.statusDanger, fontSize: 13, lineHeight: 18, fontWeight: "600", paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        Stuck
      </Text>
      {items.map((item, index) => (
        <View key={item.key} style={{ paddingHorizontal: 10, paddingVertical: 8, gap: 2, borderTopWidth: index ? 1 : 0, borderTopColor: colors.border }}>
          <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{item.title}</Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
            {item.kind === "overdue" ? `Running ${formatMinutes(item.overMin)} past its ${formatMinutes(item.estimateMin)} estimate. Timed from ` : null}
            {item.kind === "blocked" ? `Blocked${item.note ? `: ${item.note}` : ""}. Since ` : null}
            {item.kind === "manual" ? `${item.ticketId ? `${item.reason}. ` : ""}Flagged ` : null}
            <When colors={colors} iso={item.since} now={now} />
          </Text>
        </View>
      ))}
    </View>
  );
}

function TicketRow({ colors, ticket, live, now }: { colors: Colors; ticket: Ticket; live: boolean; now: number }) {
  const muted = ticket.status === "skipped";
  return (
    <View style={{
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: ticket.status === "working" ? colors.surface1 : "transparent",
    }}>
      <View style={{ width: 16, paddingTop: 2, alignItems: "center" }}>
        <IconSwap swapKey={ticket.status === "working" ? `working-${live}` : ticket.status} size={14}><StatusIcon colors={colors} status={ticket.status} live={live} /></IconSwap>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: muted ? colors.foregroundMuted : colors.foreground, fontSize: 13, lineHeight: 18, textDecorationLine: muted ? "line-through" : "none" }}>
          {ticket.title}
        </Text>
        {ticket.status === "working" && ticket.stage && ticket.stageSince ? (
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
            {ticket.stage} stage started <When colors={colors} iso={ticket.stageSince} now={now} />
          </Text>
        ) : null}
        {ticket.status === "working" && ticket.workingSince ? (
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
            Working since <When colors={colors} iso={ticket.workingSince} now={now} />
          </Text>
        ) : null}
        {ticket.note ? <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{ticket.note}</Text> : null}
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{ticket.estimateMin} min</Text>
      {/* The check mark already says done. */}
      {ticket.status === "done" ? null : <StatusBadge colors={colors} status={ticket.status} />}
    </View>
  );
}

function StatusIcon({ colors, status, live }: { colors: Colors; status: TicketStatus; live: boolean }) {
  switch (status) {
    case "done":
      return <Icon name="Check" size={14} color={colors.statusSuccess} />;
    case "working":
      return live ? <Spinner color={colors.accent} /> : <StalledPulse color={colors.statusWarning} />;
    case "blocked":
      return <Icon name="CircleAlert" size={14} color={colors.statusDanger} />;
    case "skipped":
      return <Icon name="CircleSlash" size={14} color={colors.foregroundMuted} />;
    default:
      return <Icon name="Circle" size={14} color={colors.foregroundMuted} />;
  }
}

function StatusBadge({ colors, status }: { colors: Colors; status: TicketStatus }) {
  const tone = {
    done: { fg: colors.statusSuccess, bg: "transparent", border: colors.statusSuccess },
    working: { fg: colors.accentForeground, bg: colors.accent, border: colors.accent },
    blocked: { fg: colors.statusDanger, bg: "transparent", border: colors.statusDanger },
    skipped: { fg: colors.foregroundMuted, bg: "transparent", border: colors.border },
    not_started: { fg: colors.foregroundMuted, bg: "transparent", border: colors.border },
  }[status];
  return (
    <View style={{ borderWidth: 1, borderColor: tone.border, backgroundColor: tone.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 }}>
      <Text style={{ color: tone.fg, fontSize: 11, lineHeight: 16 }}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}
