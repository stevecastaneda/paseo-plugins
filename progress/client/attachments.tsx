import { openExternalUrl, type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import React from "react";
import { Platform, Text, View } from "react-native";
import { type Attachment, attachmentIcon, canPreview, shortName } from "../shared/attachments";
import { PressableRow } from "./row";
import { openDeliverable } from "../shared/rpc";

export { type Attachment, attachmentIcon, deliverableAttachment, questionAttachments, shortName, ticketSourceAttachment } from "../shared/attachments";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type Navigation = PluginWorkspacePanelProps["navigation"];

// Shown in Paseo's preview dialog rather than handed to another app.
export function isPreviewable(attachment: Attachment): boolean {
  return canPreview(attachment, { browser: Platform.OS === "web" });
}

// Full path on the daemon host for a stored path. `root` is the worktree
// root the dashboard was read from, not the workspace directory.
export function absolutePath(path: string, root: string): string {
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return path;
  const base = root.replace(/[\\/]+$/, "");
  return path === "./" ? `${base}/` : `${base}/${path}`;
}

// Opens attachments the same way everywhere. Web links go to Paseo's browser
// (the system browser where there is none); images and text go to `onPreview` when the
// caller can show the preview dialog; every other local file opens with its
// default app on the daemon host.
export function useAttachmentOpener({ workspaceId, workspaceDirectory, navigation, onPreview }: {
  workspaceId: string;
  workspaceDirectory: string;
  navigation?: Navigation;
  onPreview?(attachment: Attachment): void;
}) {
  const toast = useToast();
  const openOnHostRpc = useRpc(openDeliverable);
  async function copyPath(attachment: Attachment, prefix = "") {
    try {
      await copyText(absolutePath(attachment.path!, workspaceDirectory));
      toast.show(`${prefix}Copied path`, { variant: prefix ? "warning" : "success" });
    } catch {
      toast.error("Could not copy. Select the path and use Copy.");
    }
  }
  async function openOnHost(attachment: Attachment) {
    try {
      await openOnHostRpc({ workspaceId, workspaceDirectory, ref: attachment.ref });
      toast.show(`Opened ${attachment.title}`, { variant: "success" });
    } catch (error) {
      await copyPath(attachment, `${error instanceof Error ? error.message : "Could not open it"}. `);
    }
  }
  async function open(attachment: Attachment) {
    if (attachment.url) {
      try {
        if (navigation?.openBrowser) navigation.openBrowser({ url: attachment.url, workspaceId });
        else await openExternalUrl(attachment.url);
      } catch {
        toast.error("Could not open this link.");
      }
      return;
    }
    if (onPreview && isPreviewable(attachment)) {
      onPreview(attachment);
      return;
    }
    await openOnHost(attachment);
  }
  return { open, openOnHost, copyPath };
}

// A question's attachments as pressable rows.
// Drawn in dialogs and the popover (surface1) unless `onSurface1` is false.
// `onOpen` also gets the whole list, so a preview can step through its siblings.
export function AttachmentList({ colors, attachments, onOpen, onSurface1 = true }: { colors: Colors; attachments: Attachment[]; onOpen(attachment: Attachment, group: Attachment[]): void; onSurface1?: boolean }) {
  if (!attachments.length) return null;
  return (
    <View style={{ gap: 2 }}>
      {attachments.map((attachment) => (
        <PressableRow key={attachment.ref} colors={colors} onSurface1={onSurface1} accessibilityRole={attachment.url ? "link" : "button"} accessibilityLabel={`Open ${attachment.title}`}
          onPress={() => onOpen(attachment, attachments)}
          style={{ flexDirection: "row", gap: 6, alignItems: "center", paddingVertical: 3, paddingHorizontal: 4, marginHorizontal: -4, borderRadius: 4 }}>
          {/* A 14px slot, like a section icon, so the title lines up with the heading above. */}
          <View style={{ width: 14, alignItems: "center" }}><Icon name={attachmentIcon(attachment)} size={12} color={colors.foregroundMuted} /></View>
          {/* The row is the target, so nothing in it is styled as a link. */}
          <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.foreground, fontSize: 12, lineHeight: 17 }}>{attachment.title}</Text>
          {shortName(attachment) !== attachment.title ? (
            <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>{shortName(attachment)}</Text>
          ) : <View style={{ flex: 1 }} />}
        </PressableRow>
      ))}
    </View>
  );
}
