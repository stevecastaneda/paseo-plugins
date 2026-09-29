import { type PluginButtonContentProps, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import React, { useRef, useState } from "react";
import { Text, View } from "react-native";
import type { Dashboard } from "../shared/dashboard";
import { useDashboard } from "./dashboard-query";
import { PressScale } from "./motion";
import { type Attachment, isPreviewable, useAttachmentOpener } from "./attachments";
import { PreviewDialog, previewable } from "./preview";
import { DefaultBadge, QuestionDetail, useCopy } from "./questions";
import { raised } from "./surfaces";

type Colors = PluginButtonContentProps["theme"]["colors"];

// Paseo caps the popover at 440px and scrolls all of it, padding included. The
// list scrolls on its own below that cap so Open Progress stays in view.
const LIST_MAX_HEIGHT = 340;

// What the pill opens: the open questions with their Copy buttons, and anything
// stuck, so the user can answer without leaving the chat.
export function AttentionPopover({ theme, host, layout, workspaceId, close, openPanel }: PluginButtonContentProps & { openPanel(): void }) {
  const colors = theme.colors;
  // Paseo draws the desktop popover on surface1 and the phone sheet on surface0.
  const onSurface1 = !layout.compact;
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const query = useDashboard(host.id, workspaceId, directory);
  const dashboard = query.data?.configured ? query.data.dashboard : null;
  const copy = useCopy();
  // Previews open in a dialog over the popover, which stays open to return to.
  // Links and other files leave Paseo, so the popover closes for those.
  const [previewing, setPreviewing] = useState<{ attachment: Attachment; group: Attachment[] } | null>(null);
  const group = useRef<Attachment[]>([]);
  const opener = useAttachmentOpener({ workspaceId, workspaceDirectory: directory ?? "", onPreview: (attachment) => setPreviewing({ attachment, group: previewable(group.current) }) });
  return (
    <View style={{ width: 360, maxWidth: "100%", gap: 8 }}>
      {dashboard ? (
        <ScrollView style={{ maxHeight: LIST_MAX_HEIGHT }} contentContainerStyle={{ gap: 12 }}>
          <AttentionList colors={colors} dashboard={dashboard} onSurface1={onSurface1} onCopy={async (question, letter) => {
            await copy(question, letter);
            close();
          }} onOpenAttachment={(attachment, from) => {
            group.current = from;
            if (!isPreviewable(attachment)) close();
            void opener.open(attachment);
          }} />
        </ScrollView>
      ) : (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
          {query.error ? `Could not read progress: ${query.error.message}` : "Loading…"}
        </Text>
      )}
      <PreviewDialog colors={colors} attachment={previewing?.attachment ?? null} workspaceId={workspaceId} workspaceDirectory={directory ?? ""}
        onClose={() => setPreviewing(null)} onOpenOnHost={(attachment) => void opener.openOnHost(attachment)}
        gallery={previewing ? { items: previewing.group, onSelect: (attachment) => setPreviewing({ ...previewing, attachment }) } : undefined} />
      <View style={{ paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
        <PressScale accessibilityRole="button" onPress={() => { close(); openPanel(); }}
          style={({ pressed }) => ({ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: 6, borderRadius: 4, ...raised(colors),
            backgroundColor: onSurface1 ? (pressed ? colors.surface1 : colors.surface2) : pressed ? colors.surface2 : colors.surface1 })}>
          <Icon name="PanelRight" size={12} color={colors.foreground} />
          <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>Open Progress</Text>
        </PressScale>
      </View>
    </View>
  );
}

export function AttentionList({ colors, dashboard, onSurface1, onCopy, onOpenAttachment }: {
  colors: Colors;
  dashboard: Dashboard;
  onSurface1: boolean;
  onCopy(question: Dashboard["questions"]["open"][number], letter: string): void;
  onOpenAttachment(attachment: Attachment, group: Attachment[]): void;
}) {
  const now = Date.now();
  // The last question can be answered while the popover is open.
  if (!dashboard.questions.open.length && !dashboard.stuck.length) {
    return <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>Nothing needs you right now.</Text>;
  }
  return (
    <>
      {dashboard.questions.open.map((question) => (
        <View key={question.id} style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 19, fontWeight: "600" }}>{question.id}</Text>
            <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 19 }}>{question.question}</Text>
            <DefaultBadge colors={colors} value={question.default} waits={question.waits} />
          </View>
          <QuestionDetail colors={colors} question={question} now={now} onSurface1={onSurface1} onCopy={(letter) => onCopy(question, letter)} onOpenAttachment={onOpenAttachment} />
        </View>
      ))}
      {dashboard.stuck.length ? (
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="OctagonAlert" size={12} color={colors.statusDanger} />
            <Text style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 17, fontWeight: "600" }}>Stuck</Text>
          </View>
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
