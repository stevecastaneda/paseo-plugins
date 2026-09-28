import { openExternalUrl, type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import React from "react";
import { Text, View } from "react-native";
import type { Deliverable, Question } from "../shared/dashboard";
import { imageMimeType, previewKind } from "../shared/preview";
import { PressableRow } from "./row";
import { openDeliverable } from "../shared/rpc";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type Navigation = PluginWorkspacePanelProps["navigation"];

// Anything the user can open: a deliverable ("D3") or a question's file ("Q7.2").
export interface Attachment {
  ref: string;
  title: string;
  path?: string;
  url?: string;
}

export function deliverableAttachment(deliverable: Deliverable): Attachment {
  return { ref: deliverable.id, title: deliverable.title, path: deliverable.path, url: deliverable.url };
}

export function questionAttachments(question: Question): Attachment[] {
  return question.files.map((file, index) => ({
    ref: `${question.id}.${index + 1}`,
    title: file.label ?? (file.path ?? file.url ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "",
    path: file.path,
    url: file.url,
  }));
}

export function isImage(attachment: Attachment): boolean {
  return Boolean(attachment.path && imageMimeType(attachment.path));
}

// One icon per kind of thing, shared with deliverables and the preview dialog.
export function attachmentIcon(attachment: Attachment): string {
  if (attachment.url) return "Globe";
  if (!attachment.path) return "File";
  const kind = previewKind(attachment.path);
  return kind === "image" ? "Image" : kind === "text" ? "FileText" : /[\/]$/.test(attachment.path) ? "Folder" : "File";
}

// Shown in Paseo's preview dialog rather than handed to another app.
export function isPreviewable(attachment: Attachment): boolean {
  return Boolean(attachment.path && previewKind(attachment.path));
}

// Full path on the daemon host for a stored path.
export function absolutePath(path: string, workspaceDirectory: string): string {
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return path;
  const base = workspaceDirectory.replace(/[\\/]+$/, "");
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

// The short name people recognize: a file or folder's own name, or a link's site.
export function shortName(attachment: Attachment): string {
  if (attachment.url) {
    try { return new URL(attachment.url).host.replace(/^www\./, ""); } catch { return attachment.url; }
  }
  return (attachment.path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
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
          <Icon name={attachmentIcon(attachment)} size={12} color={colors.foregroundMuted} />
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
