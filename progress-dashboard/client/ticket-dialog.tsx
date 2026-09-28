import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import React, { useState } from "react";
import { Text, View } from "react-native";
import type { Dashboard, Ticket } from "../shared/dashboard";
import type { TicketStatus } from "../shared/events";
import { formatMinutes } from "../shared/format";
import { type Link, ticketStory, type TimelineStep } from "../shared/ticket-story";
import { type Attachment, attachmentIcon, AttachmentList, deliverableAttachment, useAttachmentOpener } from "./attachments";
import { IconSwap, useLastPresent } from "./motion";
import { BackButton, PreviewBody } from "./preview";
import { QuestionView, useCopy } from "./questions";
import { PressableRow } from "./row";
import { Spinner, StalledPulse } from "./spinner";
import { StatusBadge } from "./status-badge";
import { When } from "./when";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type AttachmentContext = { workspaceId: string; workspaceDirectory: string; navigation: PluginWorkspacePanelProps["navigation"] };

// A ticket's story in a dialog: where its time went, and what came out of it.
// Its questions and previews open in the same dialog, stacked, with Back to
// the one before, so the backdrop never flickers between dialogs.
type Step = { kind: "ticket"; id: string } | { kind: "question"; id: string } | { kind: "preview"; attachment: Attachment };

export function TicketDialogs({ colors, dashboard, openId, setOpenId, now, live, context }: {
  colors: Colors;
  dashboard: Dashboard;
  openId: string | null;
  setOpenId(id: string | null): void;
  now: number;
  live: boolean;
  context: AttachmentContext;
}) {
  // What was opened on top of the ticket, oldest first. Cleared when a ticket opens.
  const [trail, setTrail] = useState<Step[]>([]);
  const [trailFor, setTrailFor] = useState(openId);
  if (trailFor !== openId) {
    setTrailFor(openId);
    if (openId) setTrail([]);
  }
  const push = (step: Step) => setTrail((current) => [...current, step]);
  const opener = useAttachmentOpener({ ...context, onPreview: (attachment) => push({ kind: "preview", attachment }) });
  const copy = useCopy();
  const open = openId !== null;
  const steps: Step[] = openId ? [{ kind: "ticket", id: openId }, ...trail] : [];
  // Keep drawing the last step while the dialog fades out.
  const shown = useLastPresent(steps.length ? { top: steps[steps.length - 1], previous: steps[steps.length - 2] } : null);
  const close = () => setOpenId(null);
  const back = shown?.previous ? { label: `Back to ${stepName(shown.previous)}`, onPress: () => setTrail((current) => current.slice(0, -1)) } : null;

  const top = shown?.top;
  const ticket = top?.kind === "ticket" ? dashboard.tickets.find((candidate) => candidate.id === top.id) : undefined;
  const question = top?.kind === "question"
    ? [...dashboard.questions.open, ...dashboard.questions.answered].find((candidate) => candidate.id === top.id)
    : undefined;
  const attachment = top?.kind === "preview" ? top.attachment : undefined;
  const title = ticket ? `${ticket.id} · ${ticket.title}` : question ? `${question.id} · ${question.title}` : attachment ? attachment.title : "Ticket";
  const icon = ticket ? "ListChecks" : question ? "MessageCircleQuestion" : attachment ? attachmentIcon(attachment) : "ListChecks";

  return (
    <Modal title={title} icon={<Icon name={icon} size={16} color={colors.foregroundMuted} />}
      open={open} onOpenChange={(next) => { if (!next) close(); }}>
      {attachment ? (
        <PreviewBody colors={colors} attachment={attachment} workspaceId={context.workspaceId} workspaceDirectory={context.workspaceDirectory}
          onOpenOnHost={() => { close(); void opener.openOnHost(attachment); }} backLabel={back?.label} onBack={back?.onPress} />
      ) : (
        <Modal.Content>
          {ticket ? (
            <TicketStoryView colors={colors} dashboard={dashboard} ticket={ticket} now={now} live={live}
              onOpenAttachment={(target) => void opener.open(target)} onOpenQuestion={(id) => push({ kind: "question", id })} />
          ) : null}
          {question ? (
            <QuestionView colors={colors} question={question} now={now}
              onCopy={(letter) => { void copy(question, letter); close(); }}
              onOpenAttachment={(target) => void opener.open(target)}>
              {back ? <BackButton colors={colors} label={back.label} onPress={back.onPress} /> : null}
            </QuestionView>
          ) : null}
        </Modal.Content>
      )}
    </Modal>
  );
}

function stepName(step: Step): string {
  return step.kind === "preview" ? step.attachment.title : step.id;
}

function TicketStoryView({ colors, dashboard, ticket, now, live, onOpenAttachment, onOpenQuestion }: {
  colors: Colors;
  dashboard: Dashboard;
  ticket: Ticket;
  now: number;
  live: boolean;
  onOpenAttachment(attachment: Attachment): void;
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
          <StatusBadge colors={colors} status={ticket.status} />
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontVariant: ["tabular-nums"] }}>
            Worked {formatMinutes(story.workedMin)} of a {formatMinutes(ticket.estimateMin)} estimate
            {overMin >= 1 ? <Text style={{ color: colors.statusDanger }}>, {formatMinutes(overMin)} over</Text> : null}
          </Text>
        </View>
        {ticket.note ? <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 19 }}>{ticket.note}</Text> : null}
      </View>

      <Section colors={colors} title="Timeline">
        <View>
          {story.timeline.map((step, index) => (
            <TimelineRow key={`${step.at}-${index}`} colors={colors} step={step} last={index === story.timeline.length - 1} now={now} live={live} />
          ))}
        </View>
      </Section>

      {story.deliverables.length ? (
        <Section colors={colors} title="Deliverables">
          <AttachmentList colors={colors} attachments={story.deliverables.map(deliverableAttachment)} onOpen={onOpenAttachment} />
        </Section>
      ) : null}

      {story.questions.length ? (
        <Section colors={colors} title="Questions">
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
        <Section colors={colors} title="Activity">
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

function Section({ colors, title, children }: { colors: Colors; title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{title}</Text>
      {children}
    </View>
  );
}

function LinkNote({ colors, link }: { colors: Colors; link: Link }) {
  return link === "by-time" ? <Text style={{ color: colors.foregroundMuted, opacity: 0.7 }}>  by time</Text> : null;
}

const DOT = 8;

function dotColor(colors: Colors, status: TicketStatus): string {
  return status === "done" ? colors.statusSuccess
    : status === "working" ? colors.accent
    : status === "blocked" ? colors.statusDanger
    : colors.foregroundMuted;
}

// A rail of dots joined by a line; the step still going shows the live spinner.
function TimelineRow({ colors, step, last, now, live }: { colors: Colors; step: TimelineStep; last: boolean; now: number; live: boolean }) {
  const current = last && step.minutes !== null;
  const working = current && step.status === "working";
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <View style={{ width: 12, alignItems: "center" }}>
        {/* Optical: centers the marker on the 18px first line. */}
        <View style={{ height: 18, justifyContent: "center" }}>
          <IconSwap swapKey={working ? (live ? "live" : "stale") : step.status} size={12}>
            {working ? (live ? <Spinner color={colors.accent} /> : <StalledPulse color={colors.statusWarning} />) : (
              <View style={{ width: 12, height: 12, alignItems: "center", justifyContent: "center" }}>
                <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: dotColor(colors, step.status) }} />
              </View>
            )}
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
