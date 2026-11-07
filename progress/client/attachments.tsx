import { openExternalUrl, type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, Markdown, useToast } from "@getpaseo/plugin/client/ui";
import React, { createRef, type RefObject } from "react";
import { Platform, Text, View } from "react-native";
import { type Attachment, attachmentIcon, canPreview, isFolder, isPage, opensOnHost, shortName } from "../shared/attachments";
import { localLinkTarget } from "../shared/markdown";
import { errorText } from "./errors";
import { PressableRow } from "./row";
import { openDeliverable } from "../shared/rpc";
import { useProgressLanguage } from "./language";

export { type Attachment, attachmentIcon, deliverableAttachment, questionAttachments, shortName, ticketSourceAttachment } from "../shared/attachments";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type Navigation = PluginWorkspacePanelProps["navigation"];

// Shown in Paseo's preview dialog rather than handed to another app.
export function isPreviewable(attachment: Attachment): boolean {
  return canPreview(attachment, { browser: Platform.OS === "web" });
}

// Whether Open hands it to the host's default app. The server makes the same
// check on the file itself.
export function isHostOpenable(attachment: Attachment): boolean {
  return Boolean(attachment.path) && !isFolder(attachment) && opensOnHost(attachment.path!);
}

// Full path on the daemon host for a stored path. `root` is the worktree
// root the dashboard was read from, not the workspace directory.
export function absolutePath(path: string, root: string): string {
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return path;
  const base = root.replace(/[\\/]+$/, "");
  return path === "./" ? `${base}/` : `${base}/${path}`;
}

export function useAttachmentOpener({
  workspaceId,
  workspaceDirectory,
  navigation,
  onPreview,
}: {
  workspaceId: string;
  workspaceDirectory: string;
  navigation?: Navigation;
  onPreview?(attachment: Attachment): void;
}) {
  const { messages: m } = useProgressLanguage();
  const toast = useToast();
  const openOnHostRpc = useRpc(openDeliverable);
  async function copyPath(attachment: Attachment, prefix = "") {
    try {
      await copyText(absolutePath(attachment.path!, workspaceDirectory));
      toast.show(`${prefix}${m.copyPathDone}`, { variant: prefix ? "warning" : "success" });
    } catch {
      toast.error(m.copyPathFailure);
    }
  }
  async function openOnHost(attachment: Attachment) {
    try {
      await openOnHostRpc({ workspaceId, workspaceDirectory, ref: attachment.ref });
      toast.show(m.opened(attachment.title), { variant: "success" });
    } catch (error) {
      await copyPath(attachment, `${errorText(error, m.openFailure)}. `);
    }
  }
  async function open(attachment: Attachment) {
    if (attachment.url) {
      try {
        if (navigation?.openBrowser) navigation.openBrowser({ url: attachment.url, workspaceId });
        else await openExternalUrl(attachment.url);
      } catch {
        toast.error(m.linkFailure);
      }
      return;
    }
    // A page's row is a link to it, which already opened it in a tab.
    if (isPage(attachment)) return;
    if (onPreview && isPreviewable(attachment)) {
      onPreview(attachment);
      return;
    }
    if (isHostOpenable(attachment)) await openOnHost(attachment);
    else await copyPath(attachment, `${m.openRefused}. `);
  }
  return { open, openOnHost, copyPath };
}

export const ATTACHMENT_ROW = { gap: 2, paddingVertical: 3, lineHeight: 17 };

const PAGE_LINK_FILL = Array(200).fill("████").join(" ");

// A Paseo Markdown link to a local file is the only way a plugin can open a tab,
// so a page's row holds a link to the page. On a phone the link covers the row,
// almost clear, because iOS ignores a view under 1% opaque. In a browser it stays
// hidden and the row clicks it, so the row stays one keyboard stop.
export function PageLink({ link, path }: { link: RefObject<View | null>; path: string }) {
  const target = localLinkTarget(path);
  if (Platform.OS === "web") {
    return (
      <View ref={link} style={{ display: "none" }}>
        <Markdown>{`[page](${target})`}</Markdown>
      </View>
    );
  }
  return (
    <View style={{ position: "absolute", top: 0, bottom: 0, start: 0, end: 0, overflow: "hidden", opacity: 0.011 }}>
      <Markdown>{`[${PAGE_LINK_FILL}](${target})`}</Markdown>
    </View>
  );
}

// The plugin compiles without the DOM's types.
type LinkElement = { querySelector(selector: string): { click(): void } | null };
let clickingPageLink = false;

// Opens a page row's link from the row's press, and is false for the press that
// click sends back to the row, which the first one already handled. On a phone
// the press landed on the link itself.
export function followPageLink(link: RefObject<View | null>): boolean {
  if (Platform.OS !== "web") return true;
  if (clickingPageLink) return false;
  clickingPageLink = true;
  try {
    (link.current as unknown as LinkElement | null)?.querySelector("a")?.click();
  } finally {
    clickingPageLink = false;
  }
  return true;
}

export function pageLinkRef(attachment: Attachment): RefObject<View | null> | null {
  return isPage(attachment) ? createRef<View>() : null;
}

// A question's attachments as pressable rows.
// Drawn in dialogs and the popover (surface1) unless `onSurface1` is false.
// `onOpen` also gets the whole list, so a preview can step through its siblings.
// `root` is the worktree root their paths are relative to.
export function AttachmentList({
  colors,
  attachments,
  root,
  onOpen,
  onSurface1 = true,
}: {
  colors: Colors;
  attachments: Attachment[];
  root: string;
  onOpen(attachment: Attachment, group: Attachment[]): void;
  onSurface1?: boolean;
}) {
  const { messages: m } = useProgressLanguage();
  if (!attachments.length) return null;
  return (
    <View style={{ gap: ATTACHMENT_ROW.gap }}>
      {attachments.map((attachment) => {
        const link = pageLinkRef(attachment);
        return (
          <PressableRow
            key={attachment.ref}
            colors={colors}
            onSurface1={onSurface1}
            accessibilityRole={attachment.url ? "link" : "button"}
            accessibilityLabel={m.openItem(attachment.title)}
            onPress={() => {
              if (link && !followPageLink(link)) return;
              onOpen(attachment, attachments);
            }}
            style={{
              flexDirection: "row",
              gap: 6,
              alignItems: "center",
              paddingVertical: ATTACHMENT_ROW.paddingVertical,
              paddingHorizontal: 4,
              marginHorizontal: -4,
              borderRadius: 4,
            }}
          >
            {/* A 14px slot, like a section icon, so the title lines up with the heading above. */}
            <View style={{ width: 14, alignItems: "center" }}>
              <Icon name={attachmentIcon(attachment)} size={12} color={colors.foregroundMuted} />
            </View>
            {/* The row is the target, so nothing in it is styled as a link. */}
            <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.foreground, fontSize: 12, lineHeight: ATTACHMENT_ROW.lineHeight }}>
              {attachment.title}
            </Text>
            {shortName(attachment) !== attachment.title ? (
              <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
                {shortName(attachment)}
              </Text>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            {link ? <PageLink link={link} path={absolutePath(attachment.path!, root)} /> : null}
          </PressableRow>
        );
      })}
    </View>
  );
}
