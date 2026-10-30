import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon, Markdown } from "@getpaseo/plugin/client/ui";
import React, { useState } from "react";
import { Platform, Text, View } from "react-native";
import type { Deliverable } from "../shared/dashboard";
import { opensInTab } from "../shared/attachments";
import { localLinkTarget } from "../shared/markdown";
import { type Attachment, absolutePath, attachmentIcon, deliverableAttachment, shortName, useAttachmentOpener } from "./attachments";
import { formatClientAgo } from "./i18n";
import { PressScale } from "./motion";
import { StackedDialog } from "./dialog-stack";
import { galleryFiles } from "./preview";
import { PressableRow } from "./row";
import { ShowMoreRow, usePaged } from "./show-more";
import { useProgressLanguage } from "./language";

export { absolutePath } from "./attachments";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type Navigation = PluginWorkspacePanelProps["navigation"];

const ROW_GAP = 8;
const BUTTON_PAIR_GAP = 4;
const TAP_AREA_FILL = Array(8).fill("████").join(" ");

// The Deliverables tab: newest first, 10 at a time (see usePaged).
export function DeliverablesList({ colors, deliverables, now, workspaceId, workspaceDirectory, navigation }: {
  colors: Colors;
  now: number;
  deliverables: Deliverable[];
  workspaceId: string;
  workspaceDirectory: string;
  navigation: Navigation;
}) {
  const { messages: m, locale } = useProgressLanguage();
  const [previewing, setPreviewing] = useState<Attachment | null>(null);
  const { open, copyPath } = useAttachmentOpener({ workspaceId, workspaceDirectory, navigation, onPreview: setPreviewing });
  const paged = usePaged(deliverables);
  return (
    <View>
      {paged.shown.map((deliverable, index) => {
        const attachment = deliverableAttachment(deliverable);
        const tab = opensInTab(attachment, { platform: Platform.OS });
        return (
          <PressableRow key={deliverable.id} colors={colors} accessibilityRole={deliverable.url ? "link" : "button"}
            accessibilityLabel={m.openItem(deliverable.title)}
            onPress={() => void open(attachment)}
            style={{ flexDirection: "row", gap: ROW_GAP, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: index ? 1 : 0, borderTopColor: colors.border }}>
            {/* Optical: centers the 14px icon on the 18px title line. */}
            <View style={{ paddingTop: 2 }}><Icon name={attachmentIcon(attachment)} size={14} color={colors.foregroundMuted} /></View>
            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              {/* What the agent found is the headline; the row itself is what opens. */}
              <Text numberOfLines={3} style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{deliverable.title}</Text>
              {/* Just the name, ticket and age. The full path is one press of Copy away. */}
              <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
                {[shortName(attachment), deliverable.ticketLabel ?? deliverable.ticketId, formatClientAgo(locale, deliverable.addedAt, now)].filter(Boolean).join(" · ")}
              </Text>
            </View>
            {tab ? (
              <TabButton colors={colors} label={m.openInTab(deliverable.title)} target={localLinkTarget(absolutePath(deliverable.path!, workspaceDirectory))} />
            ) : null}
            {deliverable.path ? (
              // Optical: the 22px button centers on the 18px title line.
              <PressScale accessibilityRole="button" accessibilityLabel={m.copyItemPath(deliverable.title)}
                hitSlop={tab ? { top: 6, bottom: 6, left: BUTTON_PAIR_GAP / 2, right: 6 } : 6} outerStyle={{ marginTop: -2 }}
                onPress={() => void copyPath(attachment)}
                // A step above the row's own hover tint (surface1), so it reads as its own target.
                style={({ pressed, hovered }) => ({ padding: 4, borderRadius: 4, backgroundColor: pressed ? colors.border : hovered ? colors.surface2 : "transparent" })}>
                <Icon name="Copy" size={14} color={colors.foregroundMuted} />
              </PressScale>
            ) : (
              <View style={{ paddingTop: 2 }}><Icon name="ExternalLink" size={14} color={colors.foregroundMuted} /></View>
            )}
          </PressableRow>
        );
      })}
      <ShowMoreRow colors={colors} total={deliverables.length} paged={paged} />
      <StackedDialog colors={colors} now={now} onClose={() => setPreviewing(null)} context={{ workspaceId, workspaceDirectory, navigation }}
        root={previewing ? { kind: "preview", attachment: previewing, group: galleryFiles(deliverables.map(deliverableAttachment)), fullScreen: false } : null} />
    </View>
  );
}

// A Paseo Markdown link to a local file is the only way a plugin can open a tab.
// A browser sends touches to a clear view; iOS ignores a view under 1% opaque.
function TabButton({ colors, label, target }: { colors: Colors; label: string; target: string }) {
  const linkTakesFocus = Platform.OS === "web";
  const keepPressFromRow = () => {};
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={label} focusable={!linkTakesFocus}
      outerStyle={{ marginTop: -2, marginEnd: BUTTON_PAIR_GAP - ROW_GAP, alignSelf: "flex-start" }}
      onPress={keepPressFromRow}
      style={({ pressed, hovered }) => ({ padding: 4, borderRadius: 4, overflow: "hidden", backgroundColor: pressed ? colors.border : hovered ? colors.surface2 : "transparent" })}>
      <Icon name="Maximize2" size={14} color={colors.foregroundMuted} />
      <View style={{ position: "absolute", top: -24, start: -24, width: 72, height: 72, opacity: Platform.OS === "web" ? 0 : 0.011 }}>
        <Markdown>{`[${TAP_AREA_FILL}](${target})`}</Markdown>
      </View>
    </PressScale>
  );
}
