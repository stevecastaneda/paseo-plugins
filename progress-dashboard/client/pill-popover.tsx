import { type PluginButtonContentProps, useWorkspace } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import React from "react";
import { Text, View } from "react-native";
import type { Dashboard } from "../shared/dashboard";
import { useDashboard } from "./dashboard-query";
import { PressScale } from "./motion";
import { DefaultBadge, QuestionDetail, useCopy } from "./questions";
import { raised } from "./surfaces";

type Colors = PluginButtonContentProps["theme"]["colors"];

// Paseo caps the popover at 440px and scrolls all of it, padding included. The
// list scrolls on its own below that cap so Open Progress stays in view.
const LIST_MAX_HEIGHT = 340;

// What the pill opens: the open questions with their Copy buttons, and anything
// stuck, so the user can answer without leaving the chat.
export function AttentionPopover({ theme, host, workspaceId, close, openPanel }: PluginButtonContentProps & { openPanel(): void }) {
  const colors = theme.colors;
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const query = useDashboard(host.id, workspaceId, directory);
  const dashboard = query.data?.configured ? query.data.dashboard : null;
  const copy = useCopy();
  return (
    <View style={{ width: 360, maxWidth: "100%", gap: 8 }}>
      {dashboard ? (
        <ScrollView style={{ maxHeight: LIST_MAX_HEIGHT }} contentContainerStyle={{ gap: 12 }}>
          <AttentionList colors={colors} dashboard={dashboard} onCopy={async (question, letter) => {
            await copy(question, letter);
            close();
          }} />
        </ScrollView>
      ) : (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
          {query.error ? `Could not read progress: ${query.error.message}` : "Loading…"}
        </Text>
      )}
      <View style={{ paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
        <PressScale accessibilityRole="button" onPress={() => { close(); openPanel(); }}
          style={({ pressed }) => ({ alignItems: "center", paddingVertical: 6, borderRadius: 6, ...raised(colors), backgroundColor: pressed ? colors.surface2 : colors.surface1 })}>
          <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>Open Progress</Text>
        </PressScale>
      </View>
    </View>
  );
}

export function AttentionList({ colors, dashboard, onCopy }: {
  colors: Colors;
  dashboard: Dashboard;
  onCopy(question: Dashboard["questions"]["open"][number], letter: string): void;
}) {
  const now = Date.now();
  return (
    <>
      {dashboard.questions.open.map((question) => (
        <View key={question.id} style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 19, fontWeight: "600" }}>{question.id}</Text>
            <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 19 }}>{question.question}</Text>
            <DefaultBadge colors={colors} value={question.default} waits={question.waits} />
          </View>
          <QuestionDetail colors={colors} question={question} now={now} onCopy={(letter) => onCopy(question, letter)} />
        </View>
      ))}
      {dashboard.stuck.length ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 17, fontWeight: "600" }}>Stuck</Text>
          {dashboard.stuck.map((item) => (
            <Text key={item.key} style={{ color: colors.foreground, fontSize: 12, lineHeight: 17 }}>
              {item.title}
              <Text style={{ color: colors.foregroundMuted }}>
                {item.kind === "overdue" ? " (past its estimate)" : item.kind === "blocked" ? ` (blocked${item.note ? `: ${item.note}` : ""})` : ""}
              </Text>
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );
}
