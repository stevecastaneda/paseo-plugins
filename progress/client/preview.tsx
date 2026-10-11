import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Platform, Text, useWindowDimensions, View, type ViewStyle } from "react-native";
import { type Attachment, attachmentIcon, isPreviewable } from "./attachments";
import { previewKind } from "../shared/attachments";
import { previewDeliverable, readDeliverablePiece } from "../shared/rpc";
import { PressScale, useLastPresent } from "./motion";
import { imageOutline, raised } from "./surfaces";
import { loadVideo, VideoPlayer } from "./video";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// An image or text attachment shown in a dialog, with a way out to the host's own app.
// `onBack` returns to where the preview was opened from, e.g. a question's dialog.
export function PreviewDialog({ colors, attachment, workspaceId, workspaceDirectory, onClose, onOpenOnHost, backLabel, onBack, gallery }: {
  colors: Colors;
  attachment: Attachment | null;
  workspaceId: string;
  workspaceDirectory: string;
  onClose(): void;
  onOpenOnHost(attachment: Attachment): void;
  backLabel?: string;
  onBack?(): void;
  gallery?: Gallery;
}) {
  const open = Boolean(attachment);
  attachment = useLastPresent(attachment);
  return (
    <Modal title={attachment?.title ?? "Preview"} icon={<Icon name={attachment ? attachmentIcon(attachment) : "FileText"} size={16} color={colors.foregroundMuted} />}
      open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      {attachment ? (
        <PreviewBody colors={colors} attachment={attachment} workspaceId={workspaceId} workspaceDirectory={workspaceDirectory}
          onOpenOnHost={() => { onClose(); onOpenOnHost(attachment); }} backLabel={backLabel} onBack={onBack} gallery={gallery} />
      ) : <Modal.Content>{null}</Modal.Content>}
    </Modal>
  );
}

// The other previewable files beside this one (a question's images, a ticket's
// screenshots), for Previous and Next. Only shown when there's more than one.
export interface Gallery {
  items: Attachment[];
  onSelect(attachment: Attachment): void;
}

// Keeps only what the preview can show, for a Gallery's items.
export function previewable(group: Attachment[]): Attachment[] {
  return group.filter(isPreviewable);
}

type PreviewProps = {
  colors: Colors;
  attachment: Attachment;
  workspaceId: string;
  workspaceDirectory: string;
  onOpenOnHost(): void;
  backLabel?: string;
  onBack?(): void;
  gallery?: Gallery;
};

// The preview dialog's body in its own Modal.Content.
export function PreviewBody(props: PreviewProps) {
  const [long, setLong] = useState(false);
  return <Modal.Content scrollable={!long}><PreviewContent {...props} onLong={setLong} /></Modal.Content>;
}

// The preview without its Modal.Content, for a dialog that already has one (see
// StackedDialog): swapping Modal.Content itself would re-present the sheet on phones.
// `onLong` says when the file is too tall for the dialog, so the host turns off
// its own scrolling and the file scrolls with the actions pinned below.
export function PreviewContent({ colors, attachment, workspaceId, workspaceDirectory, onOpenOnHost, backLabel, onBack, gallery, onLong }: PreviewProps & { onLong(long: boolean): void }) {
  const fetchPreview = useRpc(previewDeliverable);
  const readPiece = useRpc(readDeliverablePiece);
  const queryClient = useQueryClient();
  // How much of a video has arrived, for the line under the spinner.
  const loadingKey = (target: Attachment) => ["progress", "preview-loading", workspaceId, target.ref, target.path];
  const previewQuery = (target: Attachment) => ({
    queryKey: ["progress", "preview", workspaceId, target.ref, target.path],
    // An image or video's shape is measured here and cached with it, not held in
    // this component: Paseo remounts it when `onLong` flips the host's scrolling,
    // and a remount that forgot the shape fell back to 16:10, flipped `long` back,
    // and so on, so a tall image made the dialog jump between two sizes until closed.
    queryFn: async () => {
      const data = await fetchPreview({ workspaceId, workspaceDirectory, ref: target.ref });
      if (data.kind === "image") return { ...data, ratio: await imageRatio(data.dataUri) };
      if (data.kind !== "video") return data;
      queryClient.setQueryData(loadingKey(target), 0);
      const video = await loadVideo({
        bytes: data.bytes,
        mimeType: data.mimeType,
        readPiece: (offset) => readPiece({ workspaceId, workspaceDirectory, ref: target.ref, offset }),
        onProgress: (loaded) => queryClient.setQueryData(loadingKey(target), loaded / data.bytes),
      });
      return { ...data, video, ratio: video.ratio };
    },
    // A video isn't refetched while it's open: that would load it again and stop it playing.
    staleTime: previewKind(target.path ?? "") === "video" ? Infinity : 30_000,
    // Images arrive as data URIs up to ~13 MB and videos run to 200 MB; let them
    // go soon after the dialog moves on.
    gcTime: 30_000,
  });
  // Stepping to another file keeps this one on screen (dimmed) until the next loads,
  // so the dialog doesn't collapse to a spinner and back.
  const preview = useQuery({ ...previewQuery(attachment), placeholderData: (previous) => previous });
  const stepping = preview.isPlaceholderData;
  const loading = useQuery({ queryKey: loadingKey(attachment), queryFn: () => 0, enabled: false }).data;
  // Load the next file in the direction of travel ahead of time, so stepping is
  // instant without holding both neighbors in memory. Not a video: it can be
  // 200 MB, so it loads only when opened.
  const items = gallery?.items ?? [];
  const index = items.findIndex((item) => item.ref === attachment.ref);
  const lastIndex = useRef(index);
  useEffect(() => {
    if (index < 0 || items.length < 2) return;
    const step = (lastIndex.current - index + items.length) % items.length === 1 ? -1 : 1;
    lastIndex.current = index;
    const next = items[(index + step + items.length) % items.length];
    if (previewKind(next.path ?? "") !== "video") void queryClient.prefetchQuery(previewQuery(next));
  }, [attachment.ref, items.length]);
  // Previous and Next, wrapping at the ends. Left and right arrows do the same.
  const step = (offset: number) => gallery?.onSelect(items[(Math.max(0, index) + offset + items.length) % items.length]);
  useArrowKeys(items.length > 1 ? step : null);
  // Next has focus when the preview opens, so Enter or Space moves on too.
  const nextButton = useRef<View>(null);
  useEffect(() => {
    (nextButton.current as { focus?(): void } | null)?.focus?.();
  }, []);
  // Screenshots and recordings vary from phone-tall to full-width; size to the real
  // file. While stepping, the dimmed one on screen keeps its shape until the next arrives.
  const aspectRatio = preview.data && "ratio" in preview.data && preview.data.ratio ? preview.data.ratio : 16 / 10;
  // A video fits the dialog whole, so the controls along its bottom stay in view
  // without scrolling. A tall image scrolls instead, to keep it readable.
  const { height: windowHeight } = useWindowDimensions();
  const room = roomForContent(windowHeight);
  const maxMediaHeight = preview.data?.kind === "video" ? Math.min(640, Math.max(200, room)) : 640;
  const mediaStyle = { width: "100%", aspectRatio, maxHeight: maxMediaHeight, borderRadius: 6, ...imageOutline(colors), backgroundColor: colors.surface1, opacity: stepping ? 0.6 : 1 } as const;
  // A long file gets its own scroll area so the actions below it stay in view.
  // Short ones keep the dialog sized to them.
  const long = estimatedHeight(preview.data, aspectRatio, maxMediaHeight) > room;
  useEffect(() => onLong(long), [long]);
  // How far a video has loaded: under the spinner, or in place of the path while
  // the last file stays on screen, so nothing moves.
  const videoLoading = preview.isFetching && loading !== undefined && loading < 1 ? `Loading video, ${Math.floor(loading * 100)}%` : null;
  const caption = { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 } as const;
  const content = (
    <>
      {preview.isPending ? (
        <View style={{ alignItems: "center", gap: 8, padding: 24 }}>
          <ActivityIndicator color={colors.foregroundMuted} accessibilityLabel="Loading preview" />
          {videoLoading ? <Text style={[caption, { fontVariant: ["tabular-nums"] }]}>{videoLoading}</Text> : null}
        </View>
      ) : null}
      {preview.error ? (
        <Text accessibilityRole="alert" selectable style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 18 }}>
          Could not preview it: {preview.error.message}
        </Text>
      ) : null}
      {preview.data?.kind === "text" ? (
        <View style={{ padding: 10, borderRadius: 6, backgroundColor: colors.surface0, opacity: stepping ? 0.6 : 1 }}>
          <Text selectable style={{ color: colors.foreground, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, lineHeight: 18 }}>
            {preview.data.text}
          </Text>
          {preview.data.truncated ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16, paddingTop: 8 }}>
              Showing the first 256 KB. Press Open to see the rest in its default app.
            </Text>
          ) : null}
        </View>
      ) : null}
      {preview.data?.kind === "image" ? (
        <Image accessibilityLabel={attachment.title} source={{ uri: preview.data.dataUri }} resizeMode="contain" style={mediaStyle} />
      ) : null}
      {preview.data?.kind === "video" ? <VideoPlayer video={preview.data.video} label={attachment.title} style={mediaStyle} /> : null}
      {/* The path as a caption under the file, where it has the full width. */}
      {!preview.isPending && videoLoading ? (
        <Text style={[caption, { marginTop: -4, fontVariant: ["tabular-nums"] }]}>{videoLoading}</Text>
      ) : (
        <Text selectable numberOfLines={1} ellipsizeMode="middle" style={[caption, { marginTop: -4 }]}>
          {attachment.path}
        </Text>
      )}
    </>
  );
  // Back on the left, Previous and Next in the middle, Open on the right.
  const actions = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1, alignItems: "flex-start" }}>
        {onBack ? <BackButton colors={colors} label={backLabel ?? "Back"} onPress={onBack} /> : null}
      </View>
      {items.length > 1 ? <Stepper colors={colors} index={Math.max(0, index)} count={items.length} onStep={step} nextRef={nextButton} /> : null}
      <View style={{ flex: 1, alignItems: "flex-end" }}>
        <DialogButton colors={colors} icon="ExternalLink" label="Open" accessibilityLabel="Open in its default app" onPress={onOpenOnHost} />
      </View>
    </View>
  );
  return long ? (
    <>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12 }}>{content}</ScrollView>
      {actions}
    </>
  ) : (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 12 }}>{content}</View>
      {actions}
    </View>
  );
}

// Width left for content: Paseo's 520px dialog less its 24px padding each side.
const CONTENT_WIDTH = 472;
// Characters of 12px monospace per line of the text box (10px padding each side).
const CHARS_PER_LINE = Math.floor((CONTENT_WIDTH - 20) / 7.2);

// Roughly how tall the preview draws, including wrapped lines.
function estimatedHeight(data: { kind: "image" | "video" } | { kind: "text"; text: string } | undefined, aspectRatio: number, maxMediaHeight: number): number {
  if (!data) return 0;
  if (data.kind !== "text") return Math.min(CONTENT_WIDTH / aspectRatio, maxMediaHeight);
  const lines = data.text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0);
  return lines * 18 + 20;
}

// An image's width over its height, or null if it can't be read. Read from the data
// because onLoad doesn't report a size for data URIs on every platform.
function imageRatio(uri: string): Promise<number | null> {
  return new Promise((resolve) => {
    Image.getSize(uri, (width, height) => resolve(width && height ? width / height : null), () => resolve(null));
  });
}

// Height the dialog has for the preview before it must scroll: Paseo caps the card
// at 85% of the window (inside a 24px margin), less its header and padding, the
// path caption (17px after an 8px gap) and the footer (30px after a 20px gap).
function roomForContent(windowHeight: number): number {
  return (windowHeight - 48) * 0.85 - 57 - 48 - (8 + 17) - (20 + 30);
}

// A dialog footer button: 13px label and 14px icon, 30px tall. Icon-only is a 30px square.
export function DialogButton({ colors, icon, label, accessibilityLabel, onPress, outerStyle, ref }: { colors: Colors; icon: string; label?: string; accessibilityLabel?: string; onPress(): void; outerStyle?: ViewStyle; ref?: React.Ref<View> }) {
  return (
    <PressScale ref={ref} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} outerStyle={outerStyle}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 6,
        paddingVertical: label ? 6 : 8, paddingLeft: label ? 8 : 8, paddingRight: label ? 10 : 8,
        borderRadius: 6, ...raised(colors), backgroundColor: pressed ? colors.surface1 : colors.surface2,
      })}>
      <Icon name={icon} size={14} color={colors.foreground} />
      {label ? <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{label}</Text> : null}
    </PressScale>
  );
}

// Returns to the dialog this one was opened from. For surface1 dialogs.
export function BackButton({ colors, label, onPress }: { colors: Colors; label: string; onPress(): void }) {
  return <DialogButton colors={colors} icon="ChevronLeft" label={label} onPress={onPress} outerStyle={{ alignSelf: "flex-start" }} />;
}

// Previous and next through a gallery, with "2 of 3" between.
function Stepper({ colors, index, count, onStep, nextRef }: { colors: Colors; index: number; count: number; onStep(offset: number): void; nextRef: React.Ref<View> }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <DialogButton colors={colors} icon="ChevronLeft" accessibilityLabel="Previous file" onPress={() => onStep(-1)} />
      <Text style={{ minWidth: 44, textAlign: "center", color: colors.foregroundMuted, fontSize: 13, lineHeight: 18, fontVariant: ["tabular-nums"] }}>{index + 1} of {count}</Text>
      <DialogButton ref={nextRef} colors={colors} icon="ChevronRight" accessibilityLabel="Next file" onPress={() => onStep(1)} />
    </View>
  );
}

// Calls `onStep` with -1 or 1 for the left and right arrow keys, in the desktop
// app. Not while typing, nor on a focused video, whose controls seek with them.
function useArrowKeys(onStep: ((offset: number) => void) | null) {
  const latest = useRef(onStep);
  latest.current = onStep;
  const listening = Platform.OS === "web" && onStep !== null;
  useEffect(() => {
    if (!listening) return;
    const window = globalThis as unknown as {
      addEventListener(type: "keydown", listener: (event: KeyEvent) => void): void;
      removeEventListener(type: "keydown", listener: (event: KeyEvent) => void): void;
    };
    const onKeyDown = (event: KeyEvent) => {
      const offset = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (!offset || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (/^(VIDEO|INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName ?? "") || event.target?.isContentEditable) return;
      event.preventDefault();
      latest.current?.(offset);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [listening]);
}

type KeyEvent = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
  preventDefault(): void;
};
