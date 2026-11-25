import { type PluginWorkspacePanelProps, useAgent } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/ui";
import React, { useState } from "react";
import { type NativeSyntheticEvent, Platform, type TextInputKeyPressEventData, View } from "react-native";
import { MAX_WORDS_LENGTH, plainQuestionId } from "../shared/answers";
import type { Question } from "../shared/dashboard";
import { applyEdit, type Edit, enterEdit, indentEdit, typedBreak } from "../shared/list-edit";
import { AnswerButton, type ButtonFill } from "./answer-button";
import { useProgressLanguage } from "./language";
import { useSendAnswer } from "./send-answer";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

interface OwnAnswerProps {
  colors: Colors;
  button: ButtonFill;
  question: Question;
  workspaceId: string;
  // The worktree root, where the question's progress is kept.
  root: string;
  onCopy(answer: string): void;
  onSent(): void;
}

// Half-written answers outlive the popover and the dialog, which Paseo unmounts on close.
const drafts = new Map<string, string>();

// A field of its own per question: one half-written for another question must not go out for this one.
export function draftKey(workspaceId: string, question: Question): string {
  return `${workspaceId}:${question.askedAt}:${question.id}:${question.agentId ?? ""}`;
}

// A text field under the choices, for an answer none of them fits.
export function OwnAnswer(props: OwnAnswerProps) {
  const { agentId, id } = props.question;
  return agentId && plainQuestionId(id) ? <OwnAnswerFor {...props} agentId={agentId} /> : <OwnAnswerField {...props} />;
}

// Send when the agent that asked can be reached from this workspace; see SendOrCopy.
function OwnAnswerFor({ agentId, ...props }: OwnAnswerProps & { agentId: string }) {
  const { question, workspaceId, root, onSent } = props;
  const { send } = useSendAnswer({ workspaceId, root });
  const here = useAgent(agentId, (agent) => agent.workspaceId === workspaceId);
  if (!here) return <OwnAnswerField {...props} />;
  return (
    <OwnAnswerField
      {...props}
      onSend={(words, clear) => {
        // Kept until it's out, so a failed send loses nothing.
        void send(question, { words }).then((out) => {
          if (out) clear();
        });
        onSent();
      }}
    />
  );
}

function OwnAnswerField({
  colors,
  button,
  question,
  workspaceId,
  onCopy,
  onSend,
}: Omit<OwnAnswerProps, "onSent" | "root"> & { onSend?(words: string, clear: () => void): void }) {
  const { messages: m } = useProgressLanguage();
  const key = draftKey(workspaceId, question);
  const [words, setWords] = useState(() => drafts.get(key) ?? "");
  // Set only to move the cursor after an edit on a phone; the keyboard owns it otherwise.
  const [cursor, setCursor] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const keep = (next: string) => {
    if (next) drafts.set(key, next);
    else drafts.delete(key);
    setWords(next);
  };
  const written = Boolean(words.trim());
  const submit = () => {
    if (!written) return;
    if (!onSend) return onCopy(words.trim());
    onSend(words, () => {
      // Not when the user has typed on since.
      if (drafts.get(key) === words) keep("");
    });
  };
  return (
    <View style={{ gap: 6 }}>
      <TextInput
        multiline
        value={words}
        maxLength={MAX_WORDS_LENGTH}
        onChangeText={(typed) => {
          const next = typed.replace(/\r\n?/g, "\n");
          const at = Platform.OS === "web" ? null : typedBreak(words, next);
          const edit = at === null ? null : enterEdit(words, at, at);
          if (!edit) return keep(next);
          keep(applyEdit(words, edit));
          setCursor(edit.cursor);
        }}
        onKeyPress={(event) => {
          if (Platform.OS === "web") onDesktopKey(event as unknown as DesktopKeyEvent, submit);
        }}
        selection={cursor === null ? undefined : { start: cursor, end: cursor }}
        onSelectionChange={() => {
          if (cursor !== null) setCursor(null);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={m.ownAnswer(question.id)}
        placeholder={m.ownAnswerHint}
        placeholderTextColor={colors.foregroundMuted}
        style={[
          {
            color: colors.foreground,
            fontSize: 13,
            lineHeight: 19,
            minHeight: 37,
            maxHeight: 200,
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: focused ? colors.accent : colors.border,
            backgroundColor: button.rest,
            textAlignVertical: "top",
          },
          growing,
        ]}
      />
      {written ? (
        <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
          {onSend ? (
            <AnswerButton colors={colors} button={button} icon="Send" label={m.send} accessibilityLabel={m.sendOwnAnswer(question.id)} onPress={submit} />
          ) : null}
          <AnswerButton
            colors={colors}
            button={button}
            icon="Copy"
            label={onSend ? undefined : m.copy}
            accessibilityLabel={m.copyOwnAnswer(question.id)}
            onPress={() => onCopy(words.trim())}
          />
        </View>
      ) : null}
    </View>
  );
}

// Phones grow a multiline field by themselves. The desktop app's browser does
// with this style, which React Native has no type for.
const growing = Platform.OS === "web" ? ({ fieldSizing: "content", resize: "none", outlineStyle: "none" } as object) : null;

interface TextArea {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  setSelectionRange(start: number, end: number): void;
  ownerDocument: { execCommand(command: "insertText" | "delete", ui: boolean, text?: string): boolean };
}

type DesktopKeyEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; isComposing?: boolean; keyCode?: number }
>;

function onDesktopKey(event: DesktopKeyEvent, submit: () => void): void {
  const { key, shiftKey, metaKey, ctrlKey, altKey, isComposing, keyCode } = event.nativeEvent;
  // Enter picks a word while an input method is open. Some browsers report
  // that only as key code 229, which react-native-web checks too.
  if (isComposing || keyCode === 229 || altKey) return;
  if (key === "Enter" && (metaKey || ctrlKey)) {
    event.preventDefault();
    return submit();
  }
  if (metaKey || ctrlKey) return;
  const area = event.target as unknown as TextArea;
  const edit =
    key === "Enter" && !shiftKey
      ? enterEdit(area.value, area.selectionStart, area.selectionEnd)
      : key === "Tab"
        ? indentEdit(area.value, area.selectionStart, area.selectionEnd, Boolean(shiftKey))
        : null;
  if (!edit) return;
  event.preventDefault();
  applyInPlace(area, edit);
}

// As if the user had typed it, so undo takes it back and the field reports the change.
function applyInPlace(area: TextArea, edit: Edit): void {
  area.setSelectionRange(edit.from, edit.to);
  if (edit.insert) area.ownerDocument.execCommand("insertText", false, edit.insert);
  else if (edit.from !== edit.to) area.ownerDocument.execCommand("delete", false);
  area.setSelectionRange(edit.cursor, edit.cursorEnd ?? edit.cursor);
}
