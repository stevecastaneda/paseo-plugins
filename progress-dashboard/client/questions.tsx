import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Question } from "../shared/dashboard";
import { IconSwap, PressScale } from "./motion";
import { raised } from "./surfaces";
import { When } from "./when";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// Expanded questions per workspace, kept for the app session so polling and
// reopening the panel don't collapse what the user is reading.
const expandedByScope = new Map<string, Set<string>>();

function useExpanded(scope: string) {
  const [expanded, setExpanded] = useState(() => new Set(expandedByScope.get(scope)));
  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedByScope.set(scope, next);
    setExpanded(next);
  }
  return { expanded, toggle };
}

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
export function QuestionsSection({ colors, questions, scope, now, compact }: {
  colors: Colors;
  questions: Question[];
  scope: string;
  now: number;
  compact: boolean;
}) {
  const { expanded, toggle } = useExpanded(scope);
  const copy = useCopy();
  return (
    <View style={{ margin: 12, marginBottom: 0, borderWidth: 1, borderColor: colors.accent, borderRadius: 6, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>Questions</Text>
        <View style={{ backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 8 }}>
          <Text style={{ color: colors.accentForeground, fontSize: 11, lineHeight: 18 }}>{questions.length} waiting</Text>
        </View>
        <Text style={{ flexBasis: compact ? "100%" : undefined, flex: compact ? undefined : 1, textAlign: compact ? "left" : "right", color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
          Work continues on each default until you answer, except where it waits. Expand a question to copy an answer.
        </Text>
      </View>
      {questions.map((question, index) => (
        <QuestionRow key={question.id} colors={colors} question={question} now={now} first={index === 0}
          expanded={expanded.has(question.id)} onToggle={() => toggle(question.id)} onCopy={(letter) => void copy(question, letter)} />
      ))}
    </View>
  );
}

// Settled questions, one line each (title and the choice). Expand a row for the rest.
export function AnsweredQuestionsSection({ colors, questions, scope, now }: {
  colors: Colors;
  questions: Question[];
  scope: string;
  now: number;
}) {
  const { expanded, toggle } = useExpanded(scope);
  const copy = useCopy();
  return (
    <View style={{ margin: 12, marginBottom: 0, ...raised(colors), borderRadius: 6, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8 }}>
        <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>Answered questions</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{questions.length}</Text>
      </View>
      {questions.map((question) => {
        const answer = question.answer!;
        const chosen = question.options.find((option) => option.letter === answer.choice);
        const open = expanded.has(question.id);
        return (
          <View key={question.id} style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => toggle(question.id)}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
              <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17, fontWeight: "600", width: 22 }}>{question.id}</Text>
              <Text numberOfLines={open ? undefined : 1} style={{ flex: 1, minWidth: 0, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
                {question.title}{"  "}
                <Text style={{ color: colors.statusSuccess, fontWeight: "600" }}>{answer.choice}</Text>
                {chosen ? <Text style={{ color: colors.foreground }}> {chosen.label}</Text> : null}
              </Text>
              <IconSwap swapKey={open ? "open" : "closed"} size={14}><Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} /></IconSwap>
            </Pressable>
            {open ? (
              <View style={{ paddingLeft: 40, paddingRight: 10, paddingBottom: 10, gap: 6 }}>
                <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 19 }}>{question.question}</Text>
                <AnswerSummary colors={colors} question={question} now={now} />
                <QuestionDetail colors={colors} question={question} now={now} onCopy={(letter) => void copy(question, letter)} />
              </View>
            ) : null}
          </View>
        );
      })}
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

function QuestionRow({ colors, question, now, first, expanded, onToggle, onCopy }: {
  colors: Colors;
  question: Question;
  now: number;
  first: boolean;
  expanded: boolean;
  onToggle(): void;
  onCopy(letter?: string): void;
}) {
  const answer = question.answer;
  return (
    <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 10, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderTopColor: colors.border }}>
      <PressScale accessibilityRole="button" accessibilityLabel={`Copy ${question.id} for your reply`} onPress={() => onCopy()} hitSlop={6}
        outerStyle={{ alignSelf: "flex-start" }}
        style={({ pressed }) => ({
          paddingHorizontal: 6,
          borderRadius: 999,
          backgroundColor: pressed ? colors.surface2 : colors.surface1,
          ...raised(colors),
        })}>
        <Text style={{ color: answer ? colors.foregroundMuted : colors.foreground, fontSize: 13, lineHeight: 17, fontWeight: "600" }}>{question.id}</Text>
      </PressScale>
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onToggle}
          style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <Text style={{ flex: 1, color: answer ? colors.foregroundMuted : colors.foreground, fontSize: 13, lineHeight: 19 }}>{question.question}</Text>
          {!answer ? <DefaultBadge colors={colors} value={question.default} waits={question.waits} /> : null}
          <IconSwap swapKey={expanded ? "open" : "closed"} size={14}><Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} /></IconSwap>
        </Pressable>
        {expanded ? <QuestionDetail colors={colors} question={question} now={now} onCopy={onCopy} /> : null}
      </View>
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

export function QuestionDetail({ colors, question, now, onCopy }: { colors: Colors; question: Question; now: number; onCopy(letter: string): void }) {
  return (
    <View style={{ gap: 8, paddingTop: 2 }}>
      {question.options.map((option) => {
        const isDefault = option.letter === question.default;
        return (
          <View key={option.letter} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: isDefault ? colors.accent : colors.border }}>
            <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600", width: 14 }}>{option.letter}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>
                {option.label}{isDefault ? <Text style={{ color: colors.accent }}>  Default</Text> : null}
              </Text>
              {option.consequence ? <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{option.consequence}</Text> : null}
            </View>
            {!question.answer ? (
              <PressScale accessibilityRole="button" accessibilityLabel={`Copy ${question.id} ${option.letter} for your agent`}
                onPress={() => onCopy(option.letter)} hitSlop={4}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 6, paddingRight: 8, paddingVertical: 3, borderRadius: 4, ...raised(colors), backgroundColor: pressed ? colors.surface2 : colors.surface1 })}>
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
      {question.files.map((file) => (
        <View key={file.path} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <Icon name="File" size={12} color={colors.foregroundMuted} />
          <Text selectable numberOfLines={1} ellipsizeMode="head" style={{ flex: 1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
            {file.label ? `${file.label}: ` : ""}{file.path}
          </Text>
        </View>
      ))}
      <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
        Asked <When colors={colors} iso={question.askedAt} now={now} />{question.raisedBy ? `, raised by ${question.raisedBy}` : ""}
      </Text>
    </View>
  );
}
