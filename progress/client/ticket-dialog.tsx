import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React from "react";
import { Text, View } from "react-native";
import type { Dashboard, Ticket } from "../shared/dashboard";
import { formatMinutes } from "../shared/format";
import { type Link, ticketStory, type TimelineStep } from "../shared/ticket-story";
import { type Attachment, AttachmentList, deliverableAttachment } from "./attachments";
import { StackedDialog } from "./dialog-stack";
import { IconSwap } from "./motion";
import { PressableRow } from "./row";
import { Spinner, StalledPulse, WaitingDot } from "./spinner";
import { StatusBadge } from "./status-badge";
import { When } from "./when";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type AttachmentContext = { workspaceId: string; workspaceDirectory: string; navigation: PluginWorkspacePanelProps["navigation"] };

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

export function TicketStoryView({ colors, dashboard, ticket, now, live, onOpenAttachment, onOpenQuestion }: {
  colors: Colors;
  dashboard: Dashboard;
  ticket: Ticket;
  now: number;
  live: boolean;
  onOpenAttachment(attachment: Attachment, group: Attachment[]): void;
  onOpenQuestion(id: string): void;
}) {
  const story = ticketStory(ticket, {
    deliverables: dashboard.deliverables,
    questions: [...dashboard.questions.open, ...dashboard.questions.answered].sort((a, b) => Date.parse(a.askedAt) - Date.parse(b.askedAt)),
    activity: [...dashboard.activity].reverse(),
  }, now);
  const overMin = story.workedMin - ticket.estimateMin;
  const byTime = [...story.questions, ...story.activity].some((item) => item.link === "by-time");
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <StatusBadge colors={colors} status={ticket.status} waiting={Boolean(ticket.waitingFor)} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name="Timer" size={12} color={colors.foregroundMuted} />
            <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] }}>
              Worked {formatMinutes(story.workedMin)} of a {formatMinutes(ticket.estimateMin)} estimate
              {overMin >= 1 ? <Text style={{ color: colors.statusDanger }}>, {formatMinutes(overMin)} over</Text> : null}
            </Text>
          </View>
        </View>
        {ticket.waitingFor ? (
          <View style={{ flexDirection: "row", gap: 4 }}>
            {/* Held on the first line when a long title wraps. */}
            <View style={{ height: 18, justifyContent: "center" }}><WaitingDot color={colors.foregroundMuted} /></View>
            <Text style={{ flex: 1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>Waits for {ticket.waitingFor.id}: {ticket.waitingFor.title}</Text>
          </View>
        ) : null}
        {ticket.note ? <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 19 }}>{ticket.note}</Text> : null}
      </View>

      <Section colors={colors} icon="History" title="Timeline">
        <View>
          {story.timeline.map((step, index) => {
            const last = index === story.timeline.length - 1;
            // A current "Blocked" that's only waiting on another ticket reads as waiting, in the calm color.
            const shown = last && ticket.waitingFor && step.status === "blocked"
              ? { ...step, label: `Waiting for ${ticket.waitingFor.id}`, waiting: true }
              : step;
            return <TimelineRow key={`${step.at}-${index}`} colors={colors} step={shown} last={last} now={now} live={live} />;
          })}
        </View>
      </Section>

      {story.deliverables.length ? (
        <Section colors={colors} icon="Package" title="Deliverables">
          <AttachmentList colors={colors} attachments={story.deliverables.map(deliverableAttachment)} onOpen={onOpenAttachment} />
        </Section>
      ) : null}

      {story.questions.length ? (
        <Section colors={colors} icon="MessageCircleQuestion" title="Questions">
          <View style={{ gap: 2 }}>
            {story.questions.map((question) => {
              const chosen = question.answer ? question.options.find((option) => option.letter === question.answer!.choice) : undefined;
              return (
                <PressableRow key={question.id} colors={colors} onSurface1 accessibilityRole="button" accessibilityLabel={`Open ${question.id}`}
                  onPress={() => onOpenQuestion(question.id)}
                  style={{ flexDirection: "row", gap: 8, paddingVertical: 3, paddingHorizontal: 4, marginHorizontal: -4, borderRadius: 4 }}>
                  <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontWeight: "600", fontVariant: ["tabular-nums"], minWidth: 30 }}>{question.id}</Text>
                  <Text style={{ flex: 1, color: colors.foreground, fontSize: 12, lineHeight: 18 }}>
                    {question.title}{"  "}
                    {question.answer
                      ? <Text style={{ color: colors.statusSuccess, fontWeight: "600" }}>{question.answer.choice}{chosen ? <Text style={{ fontWeight: "400" }}> {chosen.label}</Text> : null}</Text>
                      : <Text style={{ color: question.waits ? colors.statusWarning : colors.foregroundMuted }}>Open, default {question.default}</Text>}
                    <LinkNote colors={colors} link={question.link} />
                  </Text>
                  <View style={{ paddingTop: 2 }}><Icon name="ChevronRight" size={14} color={colors.foregroundMuted} /></View>
                </PressableRow>
              );
            })}
          </View>
        </Section>
      ) : null}

      {story.activity.length ? (
        <Section colors={colors} icon="Activity" title="Activity">
          <View style={{ gap: 8 }}>
            {story.activity.map((entry) => (
              <View key={entry.id} style={{ gap: 1 }}>
                <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{entry.text}<LinkNote colors={colors} link={entry.link} /></Text>
                <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16, opacity: 0.8 }}><When colors={colors} iso={entry.at} now={now} /></Text>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {byTime ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
          Items marked “by time” weren't tagged to {ticket.id}; they happened while it was the ticket being worked on.
        </Text>
      ) : null}
    </View>
  );
}

// A section heading: a 14px icon beside the 13px semibold title, like the panel's cards.
function Section({ colors, icon, title, children }: { colors: Colors; icon: string; title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={icon} size={14} color={colors.foregroundMuted} />
        <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{title}</Text>
      </View>
      {children}
    </View>
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

// A rail of status icons joined by a line; the step still going shows the live spinner.
function TimelineRow({ colors, step, last, now, live }: { colors: Colors; step: TimelineStep & { waiting?: boolean }; last: boolean; now: number; live: boolean }) {
  const current = last && step.minutes !== null;
  const working = current && step.status === "working";
  return (
    // The rail is as wide as a section icon, so markers sit under it and labels line up with the title.
    <View style={{ flexDirection: "row", gap: 6 }}>
      <View style={{ width: 14, alignItems: "center" }}>
        {/* Optical: centers the marker on the 18px first line. */}
        <View style={{ height: 18, justifyContent: "center" }}>
          <IconSwap swapKey={working ? (live ? "live" : "stale") : step.waiting ? "waiting" : step.status} size={12}>
            {working ? (live ? <Spinner color={colors.accent} /> : <StalledPulse color={colors.statusWarning} />) : <Marker colors={colors} step={step} />}
          </IconSwap>
        </View>
        {last ? null : <View style={{ flex: 1, width: 1, backgroundColor: colors.border }} />}
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 12, gap: 1 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{step.label}</Text>
          {step.minutes !== null ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] }}>
              {formatMinutes(step.minutes)}{current ? " so far" : ""}
            </Text>
          ) : null}
        </View>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}><When colors={colors} iso={step.at} now={now} /></Text>
        {step.notes.map((note, index) => (
          <Text key={index} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17, paddingTop: 2 }}>{note}</Text>
        ))}
      </View>
    </View>
  );
}
