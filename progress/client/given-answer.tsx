import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import React from "react";
import { Text, View } from "react-native";
import type { Question } from "../shared/dashboard";
import { AnswerButton, type ButtonFill } from "./answer-button";
import { useProgressLanguage } from "./language";
import { useSendAnswer } from "./send-answer";

interface GivenAnswerProps {
  colors: PluginWorkspacePanelProps["theme"]["colors"];
  button: ButtonFill;
  question: Question;
  workspaceId: string;
  // The worktree root, where the question's progress is kept.
  root: string;
}

// What became of the answer given: who has it, or what it waits for. A choice
// that went out already says so on its button.
export function GivenAnswerRow({ colors, button, question, workspaceId, root }: GivenAnswerProps) {
  const { messages: m } = useProgressLanguage();
  const { send, cancel } = useSendAnswer({ workspaceId, root });
  const { given } = question;
  if (!given || (given.state === "sent" && "choice" in given.answer)) return null;
  const { answer, state } = given;
  return (
    <View style={{ gap: 6 }}>
      <Text selectable style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
        {state === "queued" ? m.answerQueued : state === "held" ? m.answerHeld : m.youSent}
        {m.colon}
        <Text style={{ color: colors.foreground }}>{"words" in answer ? answer.words : `${question.id} ${answer.choice}`}</Text>
      </Text>
      {state === "sent" ? null : (
        <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
          <AnswerButton
            colors={colors}
            button={button}
            icon="Send"
            label={m.sendNow}
            accessibilityLabel={m.sendNowAnswer(question.id)}
            onPress={() => void send(question, answer, true)}
          />
          <AnswerButton
            colors={colors}
            button={button}
            icon="X"
            label={m.discard}
            accessibilityLabel={m.discardAnswer(question.id)}
            onPress={() => void cancel(question)}
          />
        </View>
      )}
    </View>
  );
}
