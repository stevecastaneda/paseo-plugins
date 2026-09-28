import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { copyText, Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import React, { useState } from "react";
import { Text, View } from "react-native";
import type { Question } from "../shared/dashboard";
import { AttachmentList, type Attachment, questionAttachments, useAttachmentOpener } from "./attachments";
import { PressableRow } from "./row";
import { PressScale, useLastPresent } from "./motion";
import { PreviewDialog } from "./preview";
import { raised } from "./surfaces";
import { When } from "./when";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

export function replyPrefix(question: Pick<Question, "id" | "title">): string {
  return `${question.id} (${question.title}): `;
}

// What the Copy button on an option puts on the clipboard, ready to paste.
export function replyWithChoice(question: Pick<Question, "id" | "title">, letter: string): string {
  return `${replyPrefix(question)}${letter}`;
}

export function useCopy() {
  const toast = useToast();
  return async function copy(question: Question, letter?: string) {
    try {
      await copyText(letter ? replyWithChoice(question, letter) : replyPrefix(question));
      toast.show(letter ? `Copied "${question.id} ${letter}". Paste it to your agent.` : `Copied ${question.id} for your reply`, { variant: "success" });
    } catch {
      toast.error("Could not copy. Select the text and use Copy.");
    }
  };
}

// Questions waiting on the user. They sit at the top of the panel.
// Where a question's attachments open: the panel's workspace, and its browser.
export interface AttachmentContext {
  workspaceId: string;
  workspaceDirectory: string;
  navigation?: PluginWorkspacePanelProps["navigation"];
}

// One question dialog at a time, and the image preview it can hand off to.
// Paseo shows one dialog, so the preview replaces the question and Back returns.
function useQuestionDialogs(context: AttachmentContext) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<{ attachment: Attachment; from: string } | null>(null);
  const opener = useAttachmentOpener({
    ...context,
    onPreview: (attachment) => {
      setPreviewing({ attachment, from: openId! });
      setOpenId(null);
    },
  });
  return { openId, setOpenId, previewing, setPreviewing, opener };
}

function QuestionPreview({ colors, context, dialogs }: { colors: Colors; context: AttachmentContext; dialogs: ReturnType<typeof useQuestionDialogs> }) {
  const { previewing, setPreviewing, setOpenId, opener } = dialogs;
  return (
    <PreviewDialog colors={colors} attachment={previewing?.attachment ?? null} workspaceId={context.workspaceId} workspaceDirectory={context.workspaceDirectory}
      onClose={() => setPreviewing(null)} onOpenOnHost={(attachment) => void opener.openOnHost(attachment)}
      backLabel={previewing ? `Back to ${previewing.from}` : undefined}
      onBack={() => {
        const from = previewing?.from ?? null;
        setPreviewing(null);
        setOpenId(from);
      }} />
  );
}

export function QuestionsSection({ colors, questions, now, compact, context }: {
  colors: Colors;
  questions: Question[];
  now: number;
  compact: boolean;
  context: AttachmentContext;
}) {
  const dialogs = useQuestionDialogs(context);
  const { openId, setOpenId } = dialogs;
  const copy = useCopy();
  return (
    <View style={{ margin: 12, marginBottom: 0, borderWidth: 1, borderColor: colors.accent, borderRadius: 6, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Icon name="MessageCircleQuestion" size={14} color={colors.accent} />
        <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>Questions</Text>
        <View style={{ borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 }}>
          <Text style={{ color: colors.accentForeground, fontSize: 11, lineHeight: 16 }}>{questions.length} waiting</Text>
        </View>
        <Text style={{ flexBasis: compact ? "100%" : undefined, flex: compact ? undefined : 1, textAlign: compact ? "left" : "right", color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
          Work continues on each default until you answer, except where it waits. Press a question to see its choices and copy an answer.
        </Text>
      </View>
      {questions.map((question, index) => (
        <QuestionRow key={question.id} colors={colors} question={question} first={index === 0}
          onOpen={() => setOpenId(question.id)} onCopy={() => void copy(question)} />
      ))}
      <QuestionDialog colors={colors} question={questions.find((question) => question.id === openId) ?? null} now={now}
        onClose={() => setOpenId(null)} onCopy={(question, letter) => { void copy(question, letter); setOpenId(null); }}
        onOpenAttachment={(attachment) => void dialogs.opener.open(attachment)} />
      <QuestionPreview colors={colors} context={context} dialogs={dialogs} />
    </View>
  );
}

// Settled questions, one line each (title and the choice). Press a row for the rest.
// Rows only: the panel's tabbed card supplies the frame.
export function AnsweredQuestionsList({ colors, questions, now, context }: {
  colors: Colors;
  questions: Question[];
  now: number;
  context: AttachmentContext;
}) {
  const dialogs = useQuestionDialogs(context);
  const { openId, setOpenId } = dialogs;
  return (
    <View>
      {questions.map((question, index) => {
        const answer = question.answer!;
        const chosen = question.options.find((option) => option.letter === answer.choice);
        return (
          <View key={question.id} style={{ borderTopWidth: index ? 1 : 0, borderTopColor: colors.border }}>
            <PressableRow colors={colors} accessibilityRole="button" accessibilityLabel={`${question.id} details`} onPress={() => setOpenId(question.id)}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8 }}>
              {/* Room for two-digit ids so titles line up; longer ones widen instead of wrapping. */}
              <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17, fontWeight: "600", fontVariant: ["tabular-nums"], minWidth: 30, flexShrink: 0 }}>{question.id}</Text>
              <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
                {question.title}{"  "}
                <Text style={{ color: colors.statusSuccess, fontWeight: "600" }}>{answer.choice}</Text>
                {chosen ? <Text style={{ color: colors.foreground }}> {chosen.label}</Text> : null}
              </Text>
              <Icon name="ChevronRight" size={14} color={colors.foregroundMuted} />
            </PressableRow>
          </View>
        );
      })}
      <QuestionDialog colors={colors} question={questions.find((question) => question.id === openId) ?? null} now={now}
        onClose={() => setOpenId(null)} onCopy={() => {}} onOpenAttachment={(attachment) => void dialogs.opener.open(attachment)} />
      <QuestionPreview colors={colors} context={context} dialogs={dialogs} />
    </View>
  );
}

function AnswerSummary({ colors, question, now }: { colors: Colors; question: Question; now: number }) {
  const answer = question.answer!;
  const chosen = question.options.find((option) => option.letter === answer.choice);
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 19 }}>
        <Text style={{ color: colors.statusSuccess, fontWeight: "600" }}>{answer.choice}</Text>
        {chosen ? ` ${chosen.label}.` : ""}
        {answer.words ? <Text style={{ color: colors.foregroundMuted }}> “{answer.words}”</Text> : null}
        <Text style={{ color: colors.foregroundMuted }}>
          {answer.changedCourse ? ` Differs from the default (${question.default}), so work changes course.` : " Same as the default, so no change of course."}
        </Text>
      </Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
        Answer recorded <When colors={colors} iso={answer.at} now={now} />{question.raisedBy ? `, raised by ${question.raisedBy}` : ""}
      </Text>
    </View>
  );
}

function QuestionRow({ colors, question, first, onOpen, onCopy }: {
  colors: Colors;
  question: Question;
  first: boolean;
  onOpen(): void;
  onCopy(): void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 10, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderTopColor: colors.border }}>
      <PressScale accessibilityRole="button" accessibilityLabel={`Copy ${question.id} for your reply`} onPress={onCopy} hitSlop={6}
        outerStyle={{ alignSelf: "flex-start", marginTop: 1 }}
        style={({ pressed }) => ({
          paddingHorizontal: 6,
          borderRadius: 999,
          backgroundColor: pressed ? colors.surface2 : colors.surface1,
          ...raised(colors),
        })}>
        <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 17, fontWeight: "600" }}>{question.id}</Text>
      </PressScale>
      <PressableRow colors={colors} accessibilityRole="button" accessibilityLabel={`${question.id} choices`} onPress={onOpen}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 4, margin: -4, padding: 4 }}>
        <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 19 }}>{question.question}</Text>
        <DefaultBadge colors={colors} value={question.default} waits={question.waits} />
        {/* Optical: centers the 14px chevron on the 19px first line. */}
        <View style={{ paddingTop: 2.5 }}><Icon name="ChevronRight" size={14} color={colors.foregroundMuted} /></View>
      </PressableRow>
    </View>
  );
}

// The whole question in a dialog: choices with Copy buttons (while open), the
// answer (once settled), background and files.
function QuestionDialog({ colors, question, now, onClose, onCopy, onOpenAttachment }: {
  colors: Colors;
  question: Question | null;
  now: number;
  onClose(): void;
  onCopy(question: Question, letter: string): void;
  onOpenAttachment(attachment: Attachment): void;
}) {
  const open = Boolean(question);
  question = useLastPresent(question);
  return (
    <Modal title={question ? `${question.id} · ${question.title}` : "Question"}
      icon={<Icon name="MessageCircleQuestion" size={16} color={colors.foregroundMuted} />}
      open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Modal.Content>
        {question ? <QuestionView colors={colors} question={question} now={now} onCopy={(letter) => onCopy(question, letter)} onOpenAttachment={onOpenAttachment} /> : null}
      </Modal.Content>
    </Modal>
  );
}

// A question dialog's body, also shown inside a ticket's dialog. `children` go at the end.
export function QuestionView({ colors, question, now, onCopy, onOpenAttachment, children }: {
  colors: Colors;
  question: Question;
  now: number;
  onCopy(letter: string): void;
  onOpenAttachment(attachment: Attachment): void;
  children?: React.ReactNode;
}) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <Text style={{ flex: 1, color: colors.foreground, fontSize: 14, lineHeight: 20 }}>{question.question}</Text>
        {!question.answer ? <DefaultBadge colors={colors} value={question.default} waits={question.waits} /> : null}
      </View>
      {question.answer ? <AnswerSummary colors={colors} question={question} now={now} /> : null}
      <QuestionDetail colors={colors} question={question} now={now} onSurface1 onCopy={onCopy} onOpenAttachment={onOpenAttachment} />
      {children}
    </View>
  );
}

// A question that waits shows its default in amber: the agent is not acting on it.
export function DefaultBadge({ colors, value, waits }: { colors: Colors; value: string; waits: boolean }) {
  return (
    <View style={{ flexDirection: "row", borderWidth: 1, borderColor: waits ? colors.statusWarning : colors.accent, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 }}>
      <Text style={{ color: waits ? colors.statusWarning : colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
        Default <Text style={{ color: waits ? colors.statusWarning : colors.foreground, fontWeight: "600" }}>{value}</Text>{waits ? ", waits for you" : ""}
      </Text>
    </View>
  );
}

// `onSurface1` when drawn on a surface1 background (Paseo's dialogs), so the
// Copy buttons still stand off it.
export function QuestionDetail({ colors, question, now, onCopy, onOpenAttachment, onSurface1 = false }: {
  colors: Colors;
  question: Question;
  now: number;
  onCopy(letter: string): void;
  onOpenAttachment(attachment: Attachment): void;
  onSurface1?: boolean;
}) {
  const button = onSurface1 ? { rest: colors.surface2, pressed: colors.surface1 } : { rest: colors.surface1, pressed: colors.surface2 };
  return (
    <View style={{ gap: 8, paddingTop: 2 }}>
      {question.options.map((option) => {
        const isDefault = option.letter === question.default;
        // Once answered, the border marks the choice made; before that, the default.
        const chosen = question.answer?.choice === option.letter;
        const borderColor = question.answer ? (chosen ? colors.statusSuccess : colors.border) : isDefault ? colors.accent : colors.border;
        return (
          <View key={option.letter} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 8, borderRadius: 12, borderWidth: 1, borderColor }}>
            <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600", width: 14 }}>{option.letter}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>
                {option.label}
                {chosen ? <Text style={{ color: colors.statusSuccess }}>  Your answer</Text> : null}
                {isDefault ? <Text style={{ color: question.answer ? colors.foregroundMuted : colors.accent }}>  Default</Text> : null}
              </Text>
              {option.consequence ? <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{option.consequence}</Text> : null}
            </View>
            {!question.answer ? (
              <PressScale accessibilityRole="button" accessibilityLabel={`Copy ${question.id} ${option.letter} for your agent`}
                onPress={() => onCopy(option.letter)} hitSlop={4}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 6, paddingRight: 8, paddingVertical: 3, borderRadius: 4, ...raised(colors), backgroundColor: pressed ? button.pressed : button.rest })}>
                <Icon name="Copy" size={12} color={colors.foreground} />
                <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 16 }}>Copy {question.id} {option.letter}</Text>
              </PressScale>
            ) : null}
          </View>
        );
      })}
      {question.background ? (
        <Text selectable style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{question.background}</Text>
      ) : null}
      <AttachmentList colors={colors} attachments={questionAttachments(question)} onOpen={onOpenAttachment} />
      <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
        Asked <When colors={colors} iso={question.askedAt} now={now} />{question.raisedBy ? `, raised by ${question.raisedBy}` : ""}
      </Text>
    </View>
  );
}
