import { type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { DeliverablesList } from "./deliverables";
import { LauncherBanner, SkillBanner } from "./launcher";
import { AnsweredQuestionsList, QuestionsSection } from "./questions";
import { Spinner, StalledPulse, WaitingDot } from "./spinner";
import { IconSwap, Presence, StaggerRoot, nativeDriver } from "./motion";
import { SectionTitle } from "./section-title";
import { raised } from "./surfaces";
import { When } from "./when";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { shortTitle, type Activity, type Dashboard, type FileIssue, type ProgressSegment, type StuckItem, type Ticket } from "../shared/dashboard";
import { PROGRESS_FILE, type TicketStatus } from "../shared/events";
import { formatMinutes, formatWorkDone, minutesSince } from "../shared/format";
import { markPanelOpened } from "../shared/rpc";
import { useDashboard } from "./dashboard-query";
import { STATUS_LABEL } from "./status-badge";
import { TicketDialogs } from "./ticket-dialog";
import { PressableRow } from "./row";
import { ShowMoreRow, usePaged } from "./show-more";
import { notePanelOpened } from "./panel-opened";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];


const mono = () => (Platform.OS === "ios" ? "Menlo" : "monospace");

export function ProgressPanel(props: PluginWorkspacePanelProps) {
  return <WorkspaceProgress key={`${props.host.id}:${props.workspaceId}`} {...props} />;
}

function WorkspaceProgress({ theme, workspaceId, host, layout, navigation }: PluginWorkspacePanelProps) {
  const colors = theme.colors;
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  // Paseo marks the workspace running while any of its agents is, including a parent
  // waiting on subagents that record nothing themselves.
  const agentRunning = useWorkspace(workspaceId, (workspace) => workspace.status === "running") ?? false;
  const query = useDashboard(host.id, workspaceId, directory);
  const result = query.data ?? null;
  useMarkPanelOpened(workspaceId, directory, Boolean(result?.configured && !result.panelOpened));

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
      {/* Fades in like the dashboard's sections instead of popping in after the spinner. */}
      <Presence show={Boolean(result && !result.configured)}>{result && !result.configured ? <EmptyState colors={colors} /> : null}</Presence>
      {/* Keyed by run: a new run starts with fresh tabs, pages and dialogs. */}
      {result?.configured ? <DashboardView key={result.dashboard.run?.startedAt ?? "none"} colors={colors} dashboard={result.dashboard} agentRunning={agentRunning} compact={layout.compact}
        workspaceId={workspaceId} workspaceDirectory={directory ?? ""} navigation={navigation} /> : null}
    </ScrollView>
  );
}

// Once a run exists, opening the panel retires the "Progress" pill for
// this worktree, now and after restarts.
function useMarkPanelOpened(workspaceId: string, directory: string | null, needed: boolean) {
  const mark = useRpc(markPanelOpened);
  const sent = useRef(false);
  useEffect(() => {
    if (!needed || !directory || sent.current) return;
    sent.current = true;
    // Tell the pill only once the file exists, so its next poll agrees.
    mark({ workspaceId, workspaceDirectory: directory })
      .then(() => notePanelOpened(workspaceId))
      .catch(() => { sent.current = false; });
  }, [needed, directory, workspaceId, mark]);
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
      {/* So a new .scratch folder in the repo isn't a surprise. */}
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
        Progress is saved in <Text style={{ color: colors.foreground }}>.scratch/progress.jsonl</Text> in this worktree. The plugin adds a <Text style={{ color: colors.foreground }}>.gitignore</Text> there, so git leaves its files alone.
      </Text>
    </View>
  );
}

// A 12px icon hung beside 12/18 text. Top-aligned with an optical nudge so the
// icon stays on the first line when the text wraps.
function StatusLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      <View style={{ paddingTop: 3 }}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
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

function DashboardView({ colors, dashboard, agentRunning, compact, workspaceId, workspaceDirectory, navigation }: {
  colors: Colors;
  dashboard: Dashboard;
  agentRunning: boolean;
  compact: boolean;
  workspaceId: string;
  workspaceDirectory: string;
  navigation: PluginWorkspacePanelProps["navigation"];
}) {
  const now = useNow(15_000);
  // Quiet isn't stale while an agent in the workspace is still running.
  const stale = dashboard.stale && !agentRunning;
  const hasHistory = dashboard.activity.length + dashboard.questions.answered.length + dashboard.deliverables.length > 0;
  const live = !stale;
  // Two columns when opened as a wide tab; one in the narrow Explorer pane.
  const [wide, setWide] = useState(false);
  const attachmentContext = { workspaceId, workspaceDirectory, navigation };
  const [openTicket, setOpenTicket] = useState<string | null>(null);
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
          <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
            {dashboard.headline.map((part, index) => (
              <Text key={part.text} style={part.tone === "danger" ? { color: colors.statusDanger } : undefined}>
                {index ? ", " : ""}{part.text}
              </Text>
            ))}
          </Text>
        ) : null}
        {/* One status slot: the icon morphs from spinner (or stalled pulse) to the check on finish. */}
        {dashboard.run?.finished || dashboard.ticker ? (
          <StatusLine icon={
            <IconSwap swapKey={dashboard.run?.finished ? "finished" : live ? "live" : "stale"} size={12}>
              {dashboard.run?.finished ? <Icon name="CircleCheck" size={12} color={colors.statusSuccess} />
                : live ? <Spinner color={colors.accent} /> : <StalledPulse color={colors.statusWarning} />}
            </IconSwap>
          }>
            {dashboard.run?.finished ? (
              <>
                <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
                  <Text style={{ color: colors.statusSuccess, fontWeight: "600" }}>Finished</Text> <When colors={colors} iso={dashboard.run.finished.at} now={now} />
                </Text>
                <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 18 }}>{dashboard.run.finished.outcome}</Text>
              </>
            ) : (
              <Text accessibilityLiveRegion="polite" style={{ color: colors.foreground, fontSize: 12, lineHeight: 18 }}>{dashboard.ticker!.text}</Text>
            )}
          </StatusLine>
        ) : null}
        {/* A finished run takes no more updates, so its finish time already says this. */}
        {dashboard.updatedAt && !dashboard.run?.finished ? (
          <StatusLine icon={<Icon name="Clock" size={12} color={colors.foregroundMuted} />}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
              Last updated <When colors={colors} iso={dashboard.updatedAt} now={now} />
            </Text>
          </StatusLine>
        ) : null}
      </View>
      </Presence>
      <Presence show={Boolean(stale && dashboard.updatedAt)} order={1}>{stale && dashboard.updatedAt ? (
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
            <QuestionsSection colors={colors} questions={dashboard.questions.open} answered={dashboard.questions.answered} now={now} compact={compact || !wide} context={attachmentContext} />
          ) : null}</Presence>
          <Presence show={Boolean(dashboard.stuck.length)} order={3}>{dashboard.stuck.length ? <StuckSection colors={colors} items={dashboard.stuck} now={now} /> : null}</Presence>
          <Presence show order={4}>
          <Card colors={colors} icon="ListChecks" title={`${dashboard.run?.itemLabel ?? "Ticket"}s`}>
            {dashboard.tickets.length === 0 ? (
              <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                No {(dashboard.run?.itemLabel ?? "ticket").toLowerCase()}s yet.
              </Text>
            ) : (
              dashboard.tickets.map((ticket) => (
                <TicketRow key={ticket.id} colors={colors} ticket={ticket} live={live} now={now} onOpen={() => setOpenTicket(ticket.id)}
                  deliverables={dashboard.deliverables.filter((deliverable) => deliverable.ticketId === ticket.id).length} />
              ))
            )}
            <TicketDialogs colors={colors} dashboard={dashboard} openId={openTicket} setOpenId={setOpenTicket} now={now} live={live} context={attachmentContext} />
          </Card>
          </Presence>
        </View>
        <View style={{ flex: wide ? 2 : undefined, alignSelf: "stretch", minWidth: 0 }}>
          <Presence show={hasHistory} order={5}>
            {hasHistory ? (
              <HistoryCard colors={colors} workspaceId={workspaceId} tabs={[
                { id: "activity", label: "Activity", icon: "Activity", count: dashboard.activity.length, empty: "No activity yet.",
                  content: <ActivityList colors={colors} activity={dashboard.activity} now={now} /> },
                { id: "answered", label: "Answered", icon: "CircleCheck", count: dashboard.questions.answered.length, empty: "No answered questions yet.",
                  content: <AnsweredQuestionsList colors={colors} questions={dashboard.questions.answered} now={now} context={attachmentContext} /> },
                { id: "deliverables", label: "Deliverables", icon: "Package", count: dashboard.deliverables.length, empty: "No deliverables yet.",
                  content: <DeliverablesList colors={colors} deliverables={dashboard.deliverables} now={now} workspaceId={workspaceId}
                    workspaceDirectory={workspaceDirectory} navigation={navigation} /> },
              ]} />
            ) : null}
          </Presence>
        </View>
      </View>
    </StaggerRoot>
  );
}

type HistoryTab = "activity" | "answered" | "deliverables";
type HistoryTabEntry = { id: HistoryTab; label: string; icon: string; count: number; empty: string; content: React.ReactNode };
// Below this width the tab icons drop, so all three labels fit in the Explorer pane.
const TAB_ICONS_MIN = 370;

// The tab chosen per workspace, kept for the app session so reopening the
// panel shows the same one.
const historyTabs = new Map<string, HistoryTab>();

// Activity, answered questions and deliverables share one card: they're rarely wanted at once.
function HistoryCard({ colors, workspaceId, tabs }: { colors: Colors; workspaceId: string; tabs: HistoryTabEntry[] }) {
  const [tab, setTab] = useState<HistoryTab>(() => historyTabs.get(workspaceId) ?? "activity");
  const [showIcons, setShowIcons] = useState(true);
  const choose = (next: HistoryTab) => {
    historyTabs.set(workspaceId, next);
    setTab(next);
  };
  const current = tabs.find((entry) => entry.id === tab) ?? tabs[0];
  return (
    <View onLayout={(event) => setShowIcons(event.nativeEvent.layout.width >= TAB_ICONS_MIN)}
      style={{ margin: 12, marginBottom: 0, ...raised(colors), borderRadius: 6, overflow: "hidden" }}>
      <View accessibilityRole="tablist" style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {tabs.map((entry) => {
          return <Tab key={entry.id} colors={colors} label={entry.label} icon={showIcons ? entry.icon : null} count={entry.count} selected={entry.id === current.id} onPress={() => choose(entry.id)} />;
        })}
      </View>
      {current.count === 0 ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, paddingHorizontal: 10, paddingVertical: 8 }}>{current.empty}</Text>
      ) : current.content}
    </View>
  );
}

// Instant feedback: tabs switch often, so hover and press change color only.
function Tab({ colors, label, icon, count, selected, onPress }: { colors: Colors; label: string; icon: string | null; count: number; selected: boolean; onPress(): void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 8, paddingBottom: 6, marginBottom: -1,
        borderBottomWidth: 2,
        borderBottomColor: selected ? colors.accent : pressed || hovered ? colors.border : "transparent",
      })}>
      {icon ? <Icon name={icon} size={14} color={selected ? colors.accent : colors.foregroundMuted} /> : null}
      <Text style={{ color: selected || hovered ? colors.foreground : colors.foregroundMuted, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{label}</Text>
      {/* Count badge: muted on both tabs; the chosen tab's number reads darker. */}
      <View style={{ minWidth: 16, paddingHorizontal: 4, borderRadius: 4, alignItems: "center", backgroundColor: colors.surface2 }}>
        <Text style={{ color: selected ? colors.foreground : colors.foregroundMuted, fontSize: 10, lineHeight: 14, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{count}</Text>
      </View>
    </Pressable>
  );
}

// Newest first, 10 at a time (see usePaged).
function ActivityList({ colors, activity, now }: { colors: Colors; activity: Activity[]; now: number }) {
  const paged = usePaged(activity);
  return (
    <View>
      {paged.shown.map((entry, index) => (
        <View key={entry.id} style={{ paddingHorizontal: 10, paddingVertical: 8, gap: 1, borderTopWidth: index ? 1 : 0, borderTopColor: colors.border }}>
          {/* Muted: a log to glance at, not something to act on. */}
          <Text selectable style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 18 }}>{entry.text}</Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16, opacity: 0.8 }}>
            <When colors={colors} iso={entry.at} now={now} />
          </Text>
        </View>
      ))}
      <ShowMoreRow colors={colors} total={activity.length} paged={paged} />
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

function Card({ colors, icon, title, children }: { colors: Colors; icon: string; title: string; children: React.ReactNode }) {
  return (
    <View style={{ margin: 12, marginBottom: 0, ...raised(colors), borderRadius: 6, overflow: "hidden" }}>
      <SectionTitle colors={colors} icon={icon} title={title} />
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
          {formatWorkDone(progress.doneMin, progress.totalMin, progress.tookMin)}
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
    : segment.status === "blocked" && !segment.waiting ? colors.statusDanger
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


const STUCK_ICON: Record<StuckItem["kind"], string> = { blocked: "Ban", overdue: "Hourglass", manual: "Flag" };

function StuckSection({ colors, items, now }: { colors: Colors; items: StuckItem[]; now: number }) {
  return (
    <View style={{ margin: 12, marginBottom: 0, borderWidth: 1, borderColor: colors.statusDanger, borderRadius: 6, overflow: "hidden" }}>
      <SectionTitle colors={colors} icon="OctagonAlert" title="Stuck" color={colors.statusDanger} style={{ borderBottomWidth: 1, borderBottomColor: colors.border }} />
      {items.map((item, index) => (
        <View key={item.key} style={{ flexDirection: "row", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: index ? 1 : 0, borderTopColor: colors.border }}>
          {/* Optical: centers the 14px icon on the 18px title line. */}
          <View style={{ paddingTop: 2 }}><Icon name={STUCK_ICON[item.kind]} size={14} color={colors.statusDanger} /></View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{item.title}</Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
            {item.kind === "overdue" ? `No update for longer than its ${formatMinutes(item.estimateMin)} estimate. Last update ` : null}
            {item.kind === "blocked" ? `Blocked${item.note ? `: ${item.note}` : ""}. Since ` : null}
            {item.kind === "manual" ? `${item.ticketId ? `${item.reason}. ` : ""}Flagged ` : null}
            <When colors={colors} iso={item.since} now={now} />
          </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// Press for the ticket's story. Hover and press only tint the row: it's a list, pressed often.
function TicketRow({ colors, ticket, live, now, onOpen, deliverables }: { colors: Colors; ticket: Ticket; live: boolean; now: number; onOpen(): void; deliverables: number }) {
  const muted = ticket.status === "skipped";
  const working = ticket.status === "working";
  return (
    <PressableRow colors={colors} onSurface1={working} transparentAtRest={!working}
      accessibilityRole="button" accessibilityLabel={`${ticket.id} details`} onPress={onOpen}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
      {/* The icon is the only status mark on the row; the ticket dialog spells it out in a badge. */}
      <View accessible accessibilityLabel={ticket.waitingFor ? "Waiting" : STATUS_LABEL[ticket.status]} style={{ width: 16, paddingTop: 2, alignItems: "center" }}>
        <IconSwap swapKey={ticket.waitingFor ? "waiting" : ticket.status === "working" ? `working-${live}` : ticket.status} size={14}><StatusIcon colors={colors} status={ticket.status} live={live} waiting={Boolean(ticket.waitingFor)} /></IconSwap>
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
        {ticket.waitingFor ? (
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>Waits for {shortTitle(ticket.waitingFor.title)}</Text>
        ) : null}
        {ticket.note ? <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{ticket.note}</Text> : null}
      </View>
      {/* Fixed slots so the Package icon and estimates line up down the list, whether or not a row has deliverables; they're listed in its dialog. */}
      <View accessibilityLabel={deliverables ? (deliverables === 1 ? "Has a deliverable" : `Has ${deliverables} deliverables`) : undefined} style={{ width: 12, height: 18, justifyContent: "center" }}>
        {deliverables ? <Icon name="Package" size={12} color={colors.foregroundMuted} /> : null}
      </View>
      <Text style={{ minWidth: 44, textAlign: "right", color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] }}>{ticket.estimateMin} min</Text>
      <View style={{ paddingTop: 2 }}><Icon name="ChevronRight" size={14} color={colors.foregroundMuted} /></View>
    </PressableRow>
  );
}

function StatusIcon({ colors, status, live, waiting }: { colors: Colors; status: TicketStatus; live: boolean; waiting: boolean }) {
  if (waiting) return <WaitingDot color={colors.foregroundMuted} size={14} />;
  switch (status) {
    case "done":
      return <Icon name="Check" size={14} color={colors.statusSuccess} />;
    case "working":
      return live ? <Spinner color={colors.accent} size={14} /> : <StalledPulse color={colors.statusWarning} size={14} />;
    case "blocked":
      return <Icon name="Ban" size={14} color={colors.statusDanger} />;
    case "skipped":
      return <Icon name="CircleSlash" size={14} color={colors.foregroundMuted} />;
    default:
      return <Icon name="Circle" size={14} color={colors.foregroundMuted} />;
  }
}

