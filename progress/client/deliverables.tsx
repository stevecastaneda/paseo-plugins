import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useState } from "react";
import { Text, View } from "react-native";
import type { Deliverable } from "../shared/dashboard";
import { type Attachment, attachmentIcon, deliverableAttachment, shortName, useAttachmentOpener } from "./attachments";
import { formatAgo } from "../shared/format";
import { PressScale } from "./motion";
import { PreviewDialog, previewable } from "./preview";
import { PressableRow } from "./row";
import { ShowMoreRow, usePaged } from "./show-more";

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

// The Deliverables tab: newest first, 10 at a time (see usePaged).
export function DeliverablesList({ colors, deliverables, now, workspaceId, workspaceDirectory, navigation }: {
  colors: Colors;
  now: number;
  deliverables: Deliverable[];
  workspaceId: string;
  workspaceDirectory: string;
  navigation: Navigation;
}) {
  const [previewing, setPreviewing] = useState<Attachment | null>(null);
  // Screenshots preview inside Paseo; links open in its browser; the rest open in their own app.
  const { open, openOnHost, copyPath } = useAttachmentOpener({ workspaceId, workspaceDirectory, navigation, onPreview: setPreviewing });
  const paged = usePaged(deliverables);
  return (
    <View>
      {paged.shown.map((deliverable, index) => (
        <PressableRow key={deliverable.id} colors={colors} accessibilityRole={deliverable.url ? "link" : "button"}
          accessibilityLabel={`Open ${deliverable.title}`}
          onPress={() => void open(deliverableAttachment(deliverable))}
          style={{ flexDirection: "row", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: index ? 1 : 0, borderTopColor: colors.border }}>
          {/* Optical: centers the 14px icon on the 18px title line. */}
          <View style={{ paddingTop: 2 }}><Icon name={deliverable.kind && deliverable.kind !== "file" ? KIND_ICON[deliverable.kind] : attachmentIcon(deliverableAttachment(deliverable))} size={14} color={colors.foregroundMuted} /></View>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            {/* What the agent found is the headline; the row itself is what opens. */}
            <Text numberOfLines={3} style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{deliverable.title}</Text>
            {/* Just the name, ticket and age. The full path is one press of Copy away. */}
            <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
              {[shortName(deliverableAttachment(deliverable)), deliverable.ticketLabel ?? deliverable.ticketId, formatAgo(deliverable.addedAt, now)].filter(Boolean).join(" · ")}
            </Text>
          </View>
          {deliverable.path ? (
            // Optical: the 22px button centers on the 18px title line.
            <PressScale accessibilityRole="button" accessibilityLabel={`Copy the path of ${deliverable.title}`} hitSlop={6} outerStyle={{ marginTop: -2 }}
              onPress={() => void copyPath(deliverableAttachment(deliverable))}
              // A step above the row's own hover tint (surface1), so it reads as its own target.
              style={({ pressed, hovered }) => ({ padding: 4, borderRadius: 4, backgroundColor: pressed ? colors.border : hovered ? colors.surface2 : "transparent" })}>
              <Icon name="Copy" size={14} color={colors.foregroundMuted} />
            </PressScale>
          ) : (
            <View style={{ paddingTop: 2 }}><Icon name="ExternalLink" size={14} color={colors.foregroundMuted} /></View>
          )}
        </PressableRow>
      ))}
      <ShowMoreRow colors={colors} total={deliverables.length} paged={paged} />
      <PreviewDialog colors={colors} attachment={previewing} workspaceId={workspaceId} workspaceDirectory={workspaceDirectory}
        onClose={() => setPreviewing(null)} onOpenOnHost={(attachment) => void openOnHost(attachment)}
        gallery={{ items: previewable(deliverables.map(deliverableAttachment)), onSelect: setPreviewing }} />
    </View>
  );
}
