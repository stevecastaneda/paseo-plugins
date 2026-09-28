import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Deliverable } from "../shared/dashboard";
import { type Attachment, deliverableAttachment, useAttachmentOpener } from "./attachments";
import { PressScale } from "./motion";
import { PreviewDialog } from "./preview";
import { raised } from "./surfaces";

export { absolutePath } from "./attachments";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type Navigation = PluginWorkspacePanelProps["navigation"];

export function DeliverablesSection({ colors, deliverables, workspaceId, workspaceDirectory, navigation }: {
  colors: Colors;
  deliverables: Deliverable[];
  workspaceId: string;
  workspaceDirectory: string;
  navigation: Navigation;
}) {
  const [previewing, setPreviewing] = useState<Attachment | null>(null);
  // Screenshots preview inside Paseo; links open in its browser; the rest open in their own app.
  const { open, openOnHost, copyPath } = useAttachmentOpener({ workspaceId, workspaceDirectory, navigation, onPreview: setPreviewing });
  return (
    <View style={{ margin: 12, marginBottom: 0, ...raised(colors), borderRadius: 6, overflow: "hidden" }}>
      <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600", paddingHorizontal: 10, paddingVertical: 8 }}>
        Latest deliverables
      </Text>
      {deliverables.map((deliverable) => (
        <Pressable key={deliverable.id} accessibilityRole={deliverable.url ? "link" : "button"}
          accessibilityLabel={`Open ${deliverable.title}`}
          onPress={() => void open(deliverableAttachment(deliverable))}
          style={({ pressed }) => ({ flexDirection: "row", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: pressed ? colors.surface1 : "transparent" })}>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <Text style={{ color: colors.accent, fontSize: 13, lineHeight: 18, textDecorationLine: "underline" }}>{deliverable.title}</Text>
            <Text selectable numberOfLines={1} ellipsizeMode="head" style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
              {deliverable.url ?? deliverable.path}
            </Text>
            {deliverable.ticketLabel || deliverable.kind ? (
              <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16, opacity: 0.8 }}>
                {[deliverable.ticketLabel ?? deliverable.ticketId, deliverable.kind === "link" ? null : deliverable.kind].filter(Boolean).join(", ")}
              </Text>
            ) : null}
          </View>
          {deliverable.path ? (
            <PressScale accessibilityRole="button" accessibilityLabel={`Copy the path of ${deliverable.title}`} hitSlop={6}
              onPress={() => void copyPath(deliverableAttachment(deliverable))}
              style={({ pressed }) => ({ padding: 4, borderRadius: 4, backgroundColor: pressed ? colors.surface2 : "transparent" })}>
              <Icon name="Copy" size={14} color={colors.foregroundMuted} />
            </PressScale>
          ) : (
            <Icon name="ExternalLink" size={14} color={colors.foregroundMuted} />
          )}
        </Pressable>
      ))}
      <PreviewDialog colors={colors} attachment={previewing} workspaceId={workspaceId} workspaceDirectory={workspaceDirectory}
        onClose={() => setPreviewing(null)} onOpenOnHost={(attachment) => void openOnHost(attachment)} />
    </View>
  );
}
