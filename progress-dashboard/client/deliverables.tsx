import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useState } from "react";
import { Text, View } from "react-native";
import type { Deliverable } from "../shared/dashboard";
import { type Attachment, attachmentIcon, deliverableAttachment, useAttachmentOpener } from "./attachments";
import { PressScale } from "./motion";
import { PreviewDialog, previewable } from "./preview";
import { PressableRow } from "./row";
import { SectionTitle } from "./section-title";
import { raised } from "./surfaces";

export { absolutePath } from "./attachments";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type Navigation = PluginWorkspacePanelProps["navigation"];

const KIND_ICON: Record<NonNullable<Deliverable["kind"]>, string> = {
  file: "File",
  folder: "Folder",
  report: "FileChartColumn",
  screenshot: "Image",
  link: "Globe",
};

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
      <SectionTitle colors={colors} icon="Package" title="Latest deliverables" />
      {deliverables.map((deliverable) => (
        <PressableRow key={deliverable.id} colors={colors} accessibilityRole={deliverable.url ? "link" : "button"}
          accessibilityLabel={`Open ${deliverable.title}`}
          onPress={() => void open(deliverableAttachment(deliverable))}
          style={{ flexDirection: "row", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
          {/* Optical: centers the 14px icon on the 18px title line. */}
          <View style={{ paddingTop: 2 }}><Icon name={deliverable.kind && deliverable.kind !== "file" ? KIND_ICON[deliverable.kind] : attachmentIcon(deliverableAttachment(deliverable))} size={14} color={colors.foregroundMuted} /></View>
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
            // Optical: the 22px button centers on the 18px title line.
            <PressScale accessibilityRole="button" accessibilityLabel={`Copy the path of ${deliverable.title}`} hitSlop={6} outerStyle={{ marginTop: -2 }}
              onPress={() => void copyPath(deliverableAttachment(deliverable))}
              style={({ pressed }) => ({ padding: 4, borderRadius: 4, backgroundColor: pressed ? colors.surface2 : "transparent" })}>
              <Icon name="Copy" size={14} color={colors.foregroundMuted} />
            </PressScale>
          ) : (
            <View style={{ paddingTop: 2 }}><Icon name="ExternalLink" size={14} color={colors.foregroundMuted} /></View>
          )}
        </PressableRow>
      ))}
      <PreviewDialog colors={colors} attachment={previewing} workspaceId={workspaceId} workspaceDirectory={workspaceDirectory}
        onClose={() => setPreviewing(null)} onOpenOnHost={(attachment) => void openOnHost(attachment)}
        gallery={{ items: previewable(deliverables.map(deliverableAttachment)), onSelect: setPreviewing }} />
    </View>
  );
}
