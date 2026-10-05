import { type PluginWorkspacePanelProps, useAgent } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useState } from "react";
import { Text, View } from "react-native";
import type { Dashboard, Ticket } from "../shared/dashboard";
import { formatMinutes, formatTimeOfDay, formatWorkDone } from "../shared/format";
import { type Link, ticketStory, type TimelineStep } from "../shared/ticket-story";
import { type Attachment, AttachmentList, deliverableAttachment, ticketSourceAttachment } from "./attachments";
import { StackedDialog } from "./dialog-stack";
import { IconSwap } from "./motion";
import { PressableRow } from "./row";
import { Spinner, StalledPulse, WaitingDot } from "./spinner";
import { StatusBadge } from "./status-badge";
import { type TabEntry, TabStrip } from "./tabs";
import { TimeBar } from "./time-bar";
import { WriteUp } from "./write-up";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type AttachmentContext = { workspaceId: string; workspaceDirectory: string; navigation?: PluginWorkspacePanelProps["navigation"] };

// A ticket's story, opened from its row: where its time went, and what came out
// of it. Its questions and previews open in the same dialog (see StackedDialog).
export function TicketDialogs({ colors, dashboard, openId, setOpenId, now, live, context }: {
  colors: Colors;
  dashboard: Dashboard;
  openId: string | null;
  setOpenId(id: string | null): void;
  now: number;
  live: boolean;
  context: AttachmentContext;
}) {
  return (
    <StackedDialog colors={colors} root={openId ? { kind: "ticket", id: openId } : null} onClose={() => setOpenId(null)}
      questions={[...dashboard.questions.open, ...dashboard.questions.answered]} dashboard={dashboard} now={now} live={live} context={context} />
  );
}

export function TicketStoryView({ colors, dashboard, ticket, now, live, context, onOpenAttachment, onOpenQuestion, onOpenAgent }: {
  colors: Colors;
  dashboard: Dashboard;
  ticket: Ticket;
  now: number;
  live: boolean;
  context: AttachmentContext;
  onOpenAttachment(attachment: Attachment, group: Attachment[]): void;
  onOpenQuestion(id: string): void;
  // Undefined where Paseo can't navigate to an agent.
  onOpenAgent?(agentId: string): void;
}) {
  const story = ticketStory(ticket, {
    deliverables: dashboard.deliverables,
    questions: [...dashboard.questions.open, ...dashboard.questions.answered].sort((a, b) => Date.parse(a.askedAt) - Date.parse(b.askedAt)),
    activity: [...dashboard.activity].reverse(),
  }, now);
  const over = story.workedMin - ticket.estimateMin >= 1;
  const byTime = [...story.questions, ...story.activity].some((item) => item.link === "by-time");
  const source = ticketSourceAttachment(ticket);
  // The ticker is run-wide: it's about this ticket when this ticket's agent set
  // it, or, without agents to go by, when this is the only ticket working.
  const ticker = dashboard.ticker && ticket.status === "working" && (dashboard.ticker.by
    ? dashboard.ticker.by === ticket.agentId
    : dashboard.tickets.filter((candidate) => candidate.status === "working").length === 1) ? dashboard.ticker.text : null;
  // What the badge doesn't say: the stage it's in, or what it waits for.
  const detail = ticket.waitingFor ? `for ${ticket.waitingFor.id}: ${ticket.waitingFor.title}` : ticket.status === "working" ? ticket.stage : undefined;
  const timeline = story.timeline.map((step, index) => {
    const last = index === story.timeline.length - 1;
    // A current "Blocked" that's only waiting on another ticket reads as waiting, in the calm color.
    const shown = last && ticket.waitingFor && step.status === "blocked"
      ? { ...step, label: `Waiting for ${ticket.waitingFor.id}`, waiting: true }
      : step;
    return <TimelineRow key={`${step.at}-${index}`} colors={colors} step={shown} last={last} now={now} live={live} />;
  });
  // Only tabs with something in them; the write-up leads when there is one.
  const tabs: Array<TabEntry<StoryTab> & { content: React.ReactNode }> = [
    ...(source ? [{ id: "write-up" as const, label: "Write-up", icon: "FileText",
      content: <WriteUp colors={colors} source={source} workspaceId={context.workspaceId} workspaceDirectory={context.workspaceDirectory} onOpen={onOpenAttachment} /> }] : []),
    { id: "timeline", label: "Timeline", icon: "History", count: story.timeline.length, content: <View>{timeline}</View> },
    ...(story.activity.length ? [{ id: "activity" as const, label: "Activity", icon: "Activity", count: story.activity.length, content: (
      <View>
        {story.activity.map((entry) => (
          <View key={entry.id} style={{ flexDirection: "row", gap: 12, paddingVertical: 4 }}>
            <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 19 }}>{entry.text}<LinkNote colors={colors} link={entry.link} /></Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 19, fontVariant: ["tabular-nums"] }}>{formatTimeOfDay(entry.at, now)}</Text>
          </View>
        ))}
      </View>
    ) }] : []),
    ...(story.questions.length ? [{ id: "questions" as const, label: "Questions", icon: "MessageCircleQuestion", count: story.questions.length, content: (
      <View>
        {story.questions.map((question) => {
          const chosen = question.answer ? question.options.find((option) => option.letter === question.answer!.choice) : undefined;
          return (
            <PressableRow key={question.id} colors={colors} onSurface1 accessibilityRole="button" accessibilityLabel={`Open ${question.id}`}
              onPress={() => onOpenQuestion(question.id)}
              style={{ flexDirection: "row", gap: 8, paddingVertical: 4, paddingHorizontal: 4, marginHorizontal: -4, borderRadius: 4 }}>
              <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontWeight: "600", fontVariant: ["tabular-nums"], minWidth: 30 }}>{question.id}</Text>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{question.title}<LinkNote colors={colors} link={question.link} /></Text>
                {question.answer
                  ? <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>Answered <Text style={{ color: colors.statusSuccess, fontWeight: "600" }}>{question.answer.choice}</Text>{chosen ? <Text style={{ color: colors.foreground }}>: {chosen.label}</Text> : null}</Text>
                  : null}
              </View>
              <View style={{ paddingTop: 2 }}><Icon name="ChevronRight" size={14} color={colors.foregroundMuted} /></View>
            </PressableRow>
          );
        })}
      </View>
    ) }] : []),
    ...(story.deliverables.length ? [{ id: "deliverables" as const, label: "Deliverables", icon: "Package", count: story.deliverables.length,
      content: <AttachmentList colors={colors} attachments={story.deliverables.map(deliverableAttachment)} onOpen={onOpenAttachment} /> }] : []),
  ];
  const tabKey = `${context.workspaceId}:${ticket.id}`;
  const [chosen, setChosen] = useState<StoryTab | undefined>(() => storyTabs.get(tabKey));
  const current = tabs.find((entry) => entry.id === chosen) ?? tabs[0];
  const choose = (id: StoryTab) => {
    storyTabs.set(tabKey, id);
    setChosen(id);
  };
  return (
    <View style={{ gap: 20 }}>
      {/* The summary: where it stands, how its time compares to the estimate, and who's on it. */}
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <StatusBadge colors={colors} status={ticket.status} waiting={Boolean(ticket.waitingFor)} />
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{detail}</Text>
          <Text accessibilityLabel={`Worked ${formatMinutes(story.workedMin)} of a ${formatMinutes(ticket.estimateMin)} estimate`}
            style={{ color: over ? colors.statusDanger : colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] }}>
            {formatWorkDone(story.workedMin, ticket.estimateMin)}
          </Text>
        </View>
        <TimeBar colors={colors} workedMin={story.workedMin} estimateMin={ticket.estimateMin} />
        {ticker ? <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 19 }}>{ticker}</Text> : null}
        {ticket.note ? <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 19 }}>{ticket.note}</Text> : null}
        {ticket.agentId ? <AgentRow colors={colors} agentId={ticket.agentId} onOpen={onOpenAgent} /> : null}
      </View>

      <View style={{ gap: 12 }}>
        {tabs.length > 1 ? <TabStrip colors={colors} tabs={tabs} selected={current.id} onSelect={choose} fit /> : null}
        {current.content}
      </View>

      {byTime ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          Items marked “by time” weren't tagged to {ticket.id}; they happened while it was the {(dashboard.run?.itemLabel ?? "ticket").toLowerCase()} being worked on.
        </Text>
      ) : null}
    </View>
  );
}

type StoryTab = "write-up" | "timeline" | "activity" | "questions" | "deliverables";
// The tab chosen per ticket, kept for the app session, so coming back from a
// preview or reopening the ticket shows the same one.
const storyTabs = new Map<string, StoryTab>();

// Paseo titles a chat from the first line of its first message, cut at 60
// characters without an ellipsis (create-agent-title.ts); add the one it left off.
const PASEO_TITLE_CUT = 60;
function agentTitle(raw: string | null): string {
  const title = raw?.trim();
  if (!title) return "Untitled agent";
  return title.length === PASEO_TITLE_CUT ? `${title.trimEnd()}…` : title;
}

// The agent on a ticket, by its chat title. Pressing it
// opens that chat. Shown only while Paseo knows the agent; an archived one
// leaves nothing to open. Its state shows only when it needs the user.
function AgentRow({ colors, agentId, onOpen }: { colors: Colors; agentId: string; onOpen?(agentId: string): void }) {
  const agent = useAgent(agentId, (snapshot) => ({
    title: snapshot.title,
    alert: snapshot.requiresAttention && snapshot.attentionReason === "permission" ? { text: "Needs your permission", danger: false }
      : snapshot.status === "error" ? { text: "Stopped with an error", danger: true } : null,
  }));
  if (!agent) return null;
  const title = agentTitle(agent.title);
  const open = onOpen ? () => onOpen(agentId) : undefined;
  // A quiet line in the summary: who's on it, and the way to their chat.
  return (
    <PressableRow colors={colors} onSurface1 disabled={!open} accessibilityRole="button" accessibilityLabel={`Open the chat with ${title}`} onPress={open}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 3, paddingHorizontal: 6, marginHorizontal: -6, borderRadius: 4 }}>
      <Icon name="Bot" size={12} color={colors.foregroundMuted} />
      <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{title}</Text>
      {agent.alert ? <Text numberOfLines={1} style={{ flexShrink: 0, color: agent.alert.danger ? colors.statusDanger : colors.statusWarning, fontSize: 12, lineHeight: 17 }}>{agent.alert.text}</Text> : null}
      <View style={{ flex: 1 }} />
      {open ? <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17, fontWeight: "500" }}>Open chat</Text> : null}
    </PressableRow>
  );
}

function LinkNote({ colors, link }: { colors: Colors; link: Link }) {
  return link === "by-time" ? <Text style={{ color: colors.foregroundMuted, opacity: 0.7 }}>  by time</Text> : null;
}

// The same icons as the ticket rows, so a step reads like the status it was.
// Past stage steps get an accent ringed dot: work that happened, now over.
function Marker({ colors, step }: { colors: Colors; step: TimelineStep & { waiting?: boolean } }) {
  if (step.waiting || (step.status === "not_started" && step.label !== "Added")) return <WaitingDot color={colors.foregroundMuted} />;
  const icon = step.label === "Added" ? { name: "CirclePlus", color: colors.foregroundMuted }
    : step.status === "done" ? { name: "CircleCheck", color: colors.statusSuccess }
    : step.status === "blocked" ? { name: "Ban", color: colors.statusDanger }
    : step.status === "skipped" ? { name: "CircleSlash", color: colors.foregroundMuted }
    : { name: "CircleDot", color: colors.accent };
  return <Icon name={icon.name} size={12} color={icon.color} />;
}

// One line per step: its status icon, what it was, when it began and how long
// it took. The step still going shows the live spinner.
function TimelineRow({ colors, step, last, now, live }: { colors: Colors; step: TimelineStep & { waiting?: boolean }; last: boolean; now: number; live: boolean }) {
  const current = last && step.minutes !== null;
  const working = current && step.status === "working";
  return (
    <View style={{ paddingVertical: 4, gap: 2 }}>
      {/* Same 14px slot and gap as attachment rows, so text lines up across sections. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ width: 14, alignItems: "center" }}>
          <IconSwap swapKey={working ? (live ? "live" : "stale") : step.waiting ? "waiting" : step.status} size={12}>
            {working ? (live ? <Spinner color={colors.accent} /> : <StalledPulse color={colors.statusWarning} />) : <Marker colors={colors} step={step} />}
          </IconSwap>
        </View>
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{step.label}</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] }}>{formatTimeOfDay(step.at, now)}</Text>
        {/* A fixed column, so durations line up down the list. */}
        <Text style={{ width: 84, textAlign: "right", color: current ? colors.foreground : colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] }}>
          {step.minutes !== null ? `${formatMinutes(step.minutes)}${current ? " so far" : ""}` : ""}
        </Text>
      </View>
      {step.notes.map((note, index) => (
        <Text key={index} style={{ paddingStart: 20, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{note}</Text>
      ))}
    </View>
  );
}
