import { type PluginButtonContentProps, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import React, { useRef, useState } from "react";
import { Text, View } from "react-native";
import type { Dashboard } from "../shared/dashboard";
import { useDashboard } from "./dashboard-query";
import { progressPanel } from "./pills";
import { PressScale } from "./motion";
import { type Attachment, isPreviewable, useAttachmentOpener } from "./attachments";
import { PreviewDialog, previewable } from "./preview";
import { DefaultBadge, QuestionDetail, useCopy } from "./questions";
import { raised } from "./surfaces";

type Colors = PluginButtonContentProps["theme"]["colors"];

// On desktop, Paseo caps the popover at 440px and scrolls all of it, padding included. The
// list scrolls on its own below that cap so Open Progress stays in view.
const LIST_MAX_HEIGHT = 340;

// What the pill opens: the open questions with their Copy buttons, and anything
// stuck, so the user can answer without leaving the chat.
export function AttentionPopover({ theme, host, layout, workspaceId, close, openPanel }: PluginButtonContentProps & { openPanel(): void }) {
  const colors = theme.colors;
  // Paseo draws the desktop popover on surface1 and the phone sheet on surface0.
  const onSurface1 = !layout.compact;
  // Phones open the panel as its own tab, and are pressed with a finger.
  const touch = progressPanel().location === "workspace";
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const query = useDashboard(host.id, workspaceId, directory);
  const dashboard = query.data?.configured ? query.data.dashboard : null;
  // Stored paths are relative to the worktree root, which can sit above the workspace directory.
  const root = query.data?.root ?? directory ?? "";
  const copy = useCopy();
  // Previews open in a dialog over the popover, which stays open to return to.
  // Links and other files leave Paseo, so the popover closes for those.
  const [previewing, setPreviewing] = useState<{ attachment: Attachment; group: Attachment[] } | null>(null);
  const group = useRef<Attachment[]>([]);
  const opener = useAttachmentOpener({ workspaceId, workspaceDirectory: root, onPreview: (attachment) => setPreviewing({ attachment, group: previewable(group.current) }) });
  return (
    <View style={{ width: 360, maxWidth: "100%", gap: 8 }}>
      {dashboard ? (
        <List compact={layout.compact}>
          <AttentionList colors={colors} dashboard={dashboard} onSurface1={onSurface1} onCopy={async (question, letter) => {
            await copy(question, letter);
            close();
          }} onOpenAttachment={(attachment, from) => {
            group.current = from;
            if (!isPreviewable(attachment)) close();
            void opener.open(attachment);
          }} />
        </List>
      ) : (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
          {query.error ? `Could not read progress: ${query.error.message}` : "Loading…"}
        </Text>
      )}
      <PreviewDialog colors={colors} attachment={previewing?.attachment ?? null} workspaceId={workspaceId} workspaceDirectory={root}
        onClose={() => setPreviewing(null)} onOpenOnHost={(attachment) => void opener.openOnHost(attachment)}
        gallery={previewing ? { items: previewing.group, onSelect: (attachment) => setPreviewing({ ...previewing, attachment }) } : undefined} />
      <View style={{ paddingTop: touch ? 12 : 8, borderTopWidth: 1, borderTopColor: colors.border }}>
        {/* A full 44pt touch target on phones; desktop keeps the compact button. */}
        <PressScale accessibilityRole="button" onPress={() => { close(); openPanel(); }}
          style={({ pressed }) => ({ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: touch ? 8 : 6, paddingVertical: 6, minHeight: touch ? 44 : undefined, borderRadius: touch ? 8 : 4, ...raised(colors),
            backgroundColor: onSurface1 ? (pressed ? colors.surface1 : colors.surface2) : pressed ? colors.surface2 : colors.surface1 })}>
          {/* Beside the chat on desktop; on a phone it opens as its own tab, shown with the tab's icon. */}
          <Icon name={touch ? "ListChecks" : "PanelRight"} size={touch ? 16 : 12} color={colors.foreground} />
          <Text style={{ color: colors.foreground, fontSize: touch ? 15 : 12, lineHeight: touch ? 20 : 16, fontWeight: "600" }}>Open Progress</Text>
        </PressScale>
      </View>
    </View>
  );
}

// On a phone the popover is a sheet that already scrolls, and sizes itself to
// whichever scroll view reports last. Paseo 0.10.1 turns a ScrollView inside it
// into one of those, so a short list would shrink the sheet to its title.
function List({ compact, children }: { compact: boolean; children: React.ReactNode }) {
  if (compact) return <View style={{ gap: 12 }}>{children}</View>;
  return <ScrollView style={{ maxHeight: LIST_MAX_HEIGHT }} contentContainerStyle={{ gap: 12 }}>{children}</ScrollView>;
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
                {item.kind === "overdue" ? " (no update past its estimate)" : item.kind === "blocked" ? ` (blocked${item.note ? `: ${item.note}` : ""})` : ""}
              </Text>
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );
}
