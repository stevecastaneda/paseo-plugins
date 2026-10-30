import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, Markdown, ScrollView } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, type LayoutChangeEvent, Platform, Pressable, Text, useWindowDimensions, View, type ViewStyle } from "react-native";
import { ATTACHMENT_ROW, type Attachment, AttachmentList, isPreviewable } from "./attachments";
import { errorText } from "./errors";
import { folderAttachments, isFolder, previewKind } from "../shared/attachments";
import { canOpenOnHost, previewDeliverable, readDeliverablePiece } from "../shared/rpc";
import { PressScale } from "./motion";
import { imageOutline, raised } from "./surfaces";
import { loadVideo, VideoChangedError, VideoPlayer } from "./video";
import { useProgressLanguage } from "./language";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// The other previewable files beside this one (a question's images, a ticket's
// screenshots), for Previous and Next. Only shown when there's more than one.
export interface Gallery {
  items: Attachment[];
  onSelect(attachment: Attachment): void;
}

export function galleryFiles(group: Attachment[]): Attachment[] {
  return group.filter((attachment) => isPreviewable(attachment) && !isFolder(attachment));
}

type PreviewProps = {
  colors: Colors;
  attachment: Attachment;
  workspaceId: string;
  workspaceDirectory: string;
  onOpenOnHost(): void;
  onCopyPath(): void;
  onBack?(): void;
  gallery?: Gallery;
  onOpenEntry(attachment: Attachment, group: Attachment[]): void;
};

// `onLong` says when the file is too tall for the dialog, so the host turns off
// its own scrolling and the file scrolls with the actions pinned below.
// `hostLong` is whether the host has done that.
export function PreviewContent({ colors, attachment, workspaceId, workspaceDirectory, onOpenOnHost, onCopyPath, onBack, gallery, onOpenEntry, onLong, hostLong, fullScreen, leftFullScreen, onFullScreen }: PreviewProps & {
  onLong(long: boolean): void;
  hostLong: boolean;
  fullScreen: boolean;
  leftFullScreen: boolean;
  onFullScreen(on: boolean): void;
}) {
  const { messages: m } = useProgressLanguage();
  const fetchPreview = useRpc(previewDeliverable);
  const readPiece = useRpc(readDeliverablePiece);
  const checkHost = useRpc(canOpenOnHost);
  const queryClient = useQueryClient();
  const canOpen = useQuery({
    queryKey: ["progress", "can-open", workspaceId],
    queryFn: () => checkHost({ workspaceId, workspaceDirectory }),
    staleTime: Infinity,
  }).data?.canOpen === true;
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
      if (data.kind === "image") return { ...data, ...await imageSize(data.dataUri) };
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
    // A file that's missing, too large or outside the worktree fails the same way
    // every time, so the reason shows at once instead of after seconds of retries.
    retry: false,
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
  const step = (offset: number) => gallery?.onSelect(items[(index + offset + items.length) % items.length]);
  const inGallery = index >= 0;
  const canStep = inGallery && items.length > 1;
  useArrowKeys(canStep ? step : null);
  // Next has focus when the preview opens, so Enter or Space moves on too.
  const nextButton = useRef<View>(null);
  const fullScreenButton = useRef<View>(null);
  // Leaving full screen puts focus back on the Full screen button without the ring
  // Esc would draw, which read as if the arrows now acted on it. Set during render so
  // the ring never paints, and from `leftFullScreen` because leaving can remount this.
  const [quiet, setQuiet] = useState(leftFullScreen && !fullScreen);
  const [wasFullScreen, setWasFullScreen] = useState(fullScreen);
  if (wasFullScreen !== fullScreen) {
    setWasFullScreen(fullScreen);
    setQuiet(!fullScreen && leftFullScreen);
  }
  useEffect(() => {
    if (fullScreen) return;
    const restore = leftFullScreen && fullScreenButton.current !== null;
    if (!restore) setQuiet(false);
    focus(restore ? fullScreenButton : nextButton);
  }, [fullScreen]);
  // Screenshots and recordings vary from phone-tall to full-width; size to the real
  // file. While stepping, the dimmed one on screen keeps its shape until the next arrives.
  const aspectRatio = preview.data && "ratio" in preview.data && preview.data.ratio ? preview.data.ratio : 16 / 10;
  // A video fits the dialog whole, so the controls along its bottom stay in view
  // without scrolling. A tall image scrolls instead, to keep it readable.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // Phones and narrow windows get Paseo's bottom sheet, whose transforms would
  // keep the full-screen layer inside it.
  const fullScreenFits = Platform.OS === "web" && windowWidth >= COMPACT_BELOW;
  // By the file, not the data: while stepping, the data is still the last file's.
  const canFullScreen = fullScreenFits && previewKind(attachment.path ?? "") === "image" && preview.data?.kind === "image";
  // While stepping, the last image fills the layer until the next arrives. A file
  // that fails to load has no data at all, so full screen ends with it.
  const showsLayer = fullScreenFits && preview.data?.kind === "image";
  useEffect(() => {
    if (fullScreen && !preview.isPending && !showsLayer) onFullScreen(false);
  }, [fullScreen, preview.isPending, showsLayer]);
  const room = roomForContent(windowHeight);
  const maxMediaHeight = preview.data?.kind === "video" ? Math.min(640, Math.max(200, room)) : 640;
  const mediaStyle = { width: "100%", aspectRatio, maxHeight: maxMediaHeight, borderRadius: 6, ...imageOutline(colors), backgroundColor: colors.surface1, opacity: stepping ? 0.6 : 1 } as const;
  // Markdown's height depends on the user's text size, which a plugin can't read,
  // so only a file far too tall for any size is long before it's drawn. Anything
  // else is measured, and once it's too tall it stays long: the remount that
  // follows, an image that fails and shrinks, or a diagram that grows can't flip
  // it back. Kept in the query cache, like an image's shape, to survive the remount.
  const longKey = ["progress", "preview-long", workspaceId, attachment.ref, attachment.path];
  const latched = useQuery({ queryKey: longKey, queryFn: () => false, enabled: false }).data === true;
  const data = preview.data;
  const markdown = data?.kind === "markdown" ? data.markdown : null;
  const floor = useMemo(() => (markdown === null ? 0 : markdownFloor(markdown)), [markdown]);
  const certainlyLong = floor > 2 * room;
  // While stepping, the last file stays on screen and keeps its verdict.
  const lastLong = useRef(false);
  // A long file gets its own scroll area so the actions below it stay in view.
  // Short ones keep the dialog sized to them.
  const long = data?.kind === "markdown" ? (stepping ? lastLong.current : certainlyLong || latched) : estimatedHeight(data, aspectRatio, maxMediaHeight) > room;
  lastLong.current = long;
  useEffect(() => onLong(long), [long]);
  const measure = !long && !stepping ? (event: LayoutChangeEvent) => {
    if (event.nativeEvent.layout.height > room) queryClient.setQueryData(longKey, true);
  } : undefined;
  // How far a video has loaded: under the spinner, or in place of the path while
  // the last file stays on screen, so nothing moves.
  const videoLoading = preview.isFetching && loading !== undefined && loading < 1 ? m.loadingVideo(Math.floor(loading * 100)) : null;
  const caption = { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 } as const;
  const loadingState = (
    <View style={{ alignItems: "center", gap: 8, padding: 24 }}>
      <ActivityIndicator color={colors.foregroundMuted} accessibilityLabel={m.loadingPreview} />
      {videoLoading ? <Text style={[caption, { fontVariant: ["tabular-nums"] }]}>{videoLoading}</Text> : null}
    </View>
  );
  const truncatedNote = (paddingTop: number) => <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16, paddingTop }}>{m.truncatedText}{canOpen ? m.openRest : ""}</Text>;
  const content = (
    <>
      {preview.isPending ? loadingState : null}
      {preview.error ? (
        <Text accessibilityRole="alert" selectable style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 18 }}>
          {m.previewError(preview.error instanceof VideoChangedError ? m.videoChanged : errorText(preview.error, m.unknownError))}
        </Text>
      ) : null}
      {preview.data?.kind === "text" ? (
        <View style={{ padding: 10, borderRadius: 6, backgroundColor: colors.surface0, opacity: stepping ? 0.6 : 1 }}>
          <Text selectable style={{ color: colors.foreground, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, lineHeight: 18 }}>
            {preview.data.text}
          </Text>
          {preview.data.truncated ? truncatedNote(8) : null}
        </View>
      ) : null}
      {/* Straight on the dialog: Paseo's code blocks and tables bring their own fills.
          A file that's long for certain waits for the host's scroll area, so it isn't
          drawn once for nothing in the dialog it's about to leave. The note sits
          outside the Markdown, where a cut fence can't take it in. */}
      {preview.data?.kind === "markdown" ? (certainlyLong && !hostLong ? loadingState : (
        <View onLayout={measure} style={{ gap: 12, opacity: stepping ? 0.6 : 1 }}>
          <Markdown>{preview.data.markdown}</Markdown>
          {preview.data.truncated ? truncatedNote(0) : null}
        </View>
      )) : null}
      {preview.data?.kind === "folder" ? (
        <FolderList colors={colors} folder={attachment} entries={folderAttachments(attachment, preview.data.entries)} truncated={preview.data.truncated}
          dimmed={stepping} onOpen={onOpenEntry} />
      ) : null}
      {preview.data?.kind === "image" ? (
        // The Full screen button is the keyboard's way in, so the image isn't a second tab stop.
        <Pressable disabled={!canFullScreen} focusable={false} onPress={() => onFullScreen(true)}
          style={{ width: "100%", cursor: canFullScreen ? "zoom-in" as unknown as ViewStyle["cursor"] : undefined }}>
          <Image accessibilityLabel={attachment.title} source={{ uri: preview.data.dataUri }} resizeMode="contain" style={mediaStyle} />
        </Pressable>
      ) : null}
      {preview.data?.kind === "video" ? <VideoPlayer video={preview.data.video} label={attachment.title} style={mediaStyle} /> : null}
    </>
  );
  // The path as a caption under the file, where it has the full width, with Copy
  // beside it so it can go into a message without leaving the dialog. A long
  // file scrolls above it, so it stays in view with the actions.
  const path = !preview.isPending && videoLoading ? (
    <Text style={[caption, { fontVariant: ["tabular-nums"] }]}>{videoLoading}</Text>
  ) : (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text selectable numberOfLines={1} ellipsizeMode="middle" style={[caption, { flex: 1, minWidth: 0 }]}>
        {attachment.path}
      </Text>
      {/* Optical: the 22px button centers on the 17px caption line without growing it. */}
      <PressScale accessibilityRole="button" accessibilityLabel={m.copyItemPath(attachment.title)} hitSlop={6} outerStyle={{ marginVertical: -3 }}
        onPress={onCopyPath}
        style={({ pressed, hovered }) => ({ padding: 4, borderRadius: 4, backgroundColor: pressed ? colors.border : hovered ? colors.surface2 : "transparent" })}>
        <Icon name="Copy" size={14} color={colors.foregroundMuted} />
      </PressScale>
    </View>
  );
  // Back on the left, Previous and Next in the middle, Open on the right.
  const actions = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1, alignItems: "flex-start" }}>
        {onBack ? <BackButton colors={colors} onPress={onBack} /> : null}
      </View>
      {canStep ? <Stepper colors={colors} index={index} count={items.length} onStep={step} nextRef={nextButton} /> : null}
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
        {canFullScreen ? (
          // An inline outline beats Paseo's :focus-visible ring.
          <DialogButton ref={fullScreenButton} colors={colors} icon="Maximize2" accessibilityLabel={m.fullScreen} onPress={() => onFullScreen(true)}
            outerStyle={quiet ? { outlineWidth: 0 } : undefined} onBlur={() => setQuiet(false)} />
        ) : null}
        {canOpen ? <DialogButton colors={colors} icon="ExternalLink" label={m.open} accessibilityLabel={m.openDefault} onPress={onOpenOnHost} /> : null}
      </View>
    </View>
  );
  const layerShown = fullScreen && showsLayer;
  // An SVG stays sharp at any size, so only a bitmap stops at its own pixels. An
  // icon's SVG can say it's 24px wide.
  const fullScreenLayer = layerShown && preview.data?.kind === "image" ? (
    <FullScreenImage title={attachment.title} uri={preview.data.dataUri} ratio={aspectRatio} dimmed={stepping} onExit={() => onFullScreen(false)}
      naturalWidth={preview.data.dataUri.startsWith("data:image/svg+xml") ? null : preview.data.width} />
  ) : null;
  // Paseo's focus trap counts the controls under the layer, so Shift+Tab would
  // reach a hidden Open. Inert takes them out until full screen ends.
  const body = useRef<View>(null);
  useEffect(() => {
    if (!layerShown) return;
    const element = body.current as unknown as { setAttribute?(name: string, value: string): void; removeAttribute?(name: string): void } | null;
    element?.setAttribute?.("inert", "");
    return () => element?.removeAttribute?.("inert");
  }, [layerShown]);
  return (
    <>
      {long ? (
        <View ref={body} style={{ flex: 1 }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12 }}>{content}</ScrollView>
          <View style={{ marginTop: 8 }}>{path}</View>
          {actions}
        </View>
      ) : (
        <View ref={body} style={{ gap: 20 }}>
          <View style={{ gap: 8 }}>
            <View style={{ gap: 12 }}>{content}</View>
            {path}
          </View>
          {actions}
        </View>
      )}
      {fullScreenLayer}
    </>
  );
}

const FULL_SCREEN_MARGIN = 24;
const FULL_SCREEN_BAR = 52;

// The image over the whole window, never past its own pixels. It fits whole, or a
// long one can fill the width and scroll.
function FullScreenImage({ title, uri, naturalWidth, ratio, dimmed, onExit }: { title: string; uri: string; naturalWidth: number | null; ratio: number; dimmed: boolean; onExit(): void }) {
  const { messages: m } = useProgressLanguage();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const closeButton = useRef<View>(null);
  const fitButton = useRef<View>(null);
  const scrollArea = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => focus(closeButton), []);
  const [fit, setFit] = useState<"screen" | "width">("screen");
  const room = windowHeight - 2 * FULL_SCREEN_MARGIN - FULL_SCREEN_BAR;
  const widthFit = Math.max(0, Math.min(naturalWidth ?? Infinity, windowWidth - 2 * FULL_SCREEN_MARGIN));
  const screenFit = Math.min(widthFit, room * ratio);
  // Only an image that fills the width at least half again as large as it fits
  // whole gets the choice. An ordinary window screenshot gains a little and reads
  // fine whole; a phone screenshot or a long page doesn't.
  const long = widthFit >= screenFit * 1.5;
  const scrolls = long && fit === "width";
  const toggle = () => setFit(scrolls ? "screen" : "width");
  // Fit to width hands the keys to the scroll area, so the arrows, Page Up and
  // Down, Home, End and Space scroll it. When the area goes, focus goes back to the bar.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolls) focus(scrollArea);
    else if (scrolled.current) focus(long ? fitButton : closeButton);
    scrolled.current = scrolls;
  }, [scrolls, uri]);
  const light = "rgba(255, 255, 255, 0.85)";
  const barButton = ({ pressed, hovered }: { pressed: boolean; hovered: boolean }) => ({
    height: 36, alignItems: "center", justifyContent: "center", borderRadius: 6,
    backgroundColor: pressed ? "rgba(255, 255, 255, 0.16)" : hovered ? "rgba(255, 255, 255, 0.1)" : "transparent",
  }) as const;
  // A press on the image stops there, so only the black around it exits.
  // The fit button is the keyboard's way to the toggle, so the image isn't a tab stop.
  const area = (
    <Pressable accessible={false} focusable={false} onPress={onExit}
      style={{ flexGrow: 1, alignItems: "center", justifyContent: "center", padding: FULL_SCREEN_MARGIN }}>
      <Pressable accessible={false} focusable={false} onPress={long ? toggle : () => {}}
        style={{ cursor: (long ? (scrolls ? "zoom-out" : "zoom-in") : "default") as unknown as ViewStyle["cursor"] }}>
        <Image accessibilityLabel={title} source={{ uri }} resizeMode="contain"
          style={{ width: scrolls ? widthFit : screenFit, aspectRatio: ratio, borderRadius: 6, borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.1)", opacity: dimmed ? 0.6 : 1 }} />
      </Pressable>
    </Pressable>
  );
  return (
    <View style={{ position: "fixed" as unknown as ViewStyle["position"], top: 0, right: 0, bottom: 0, left: 0, zIndex: 1000, backgroundColor: "black" }}>
      <View style={{ height: FULL_SCREEN_BAR, flexDirection: "row", alignItems: "center", gap: 12, paddingStart: FULL_SCREEN_MARGIN, paddingEnd: 12 }}>
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: light, fontSize: 13, lineHeight: 18 }}>{title}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {long ? (
            <PressScale ref={fitButton} accessibilityRole="button" onPress={toggle}
              style={(state) => ({ ...barButton(state), flexDirection: "row", gap: 6, paddingHorizontal: 10 })}>
              <Icon name={scrolls ? "Shrink" : "MoveHorizontal"} size={16} color={light} />
              <Text style={{ color: light, fontSize: 13, lineHeight: 18 }}>{scrolls ? m.fitToScreen : m.fitToWidth}</Text>
            </PressScale>
          ) : null}
          <PressScale ref={closeButton} accessibilityRole="button" accessibilityLabel={m.exitFullScreen} onPress={onExit}
            style={(state) => ({ ...barButton(state), width: 36 })}>
            <Icon name="X" size={18} color={light} />
          </PressScale>
        </View>
      </View>
      {/* Keyed so the next image starts at its top. The fit button stays the visible
          keyboard control, so the scroll area draws no focus ring. */}
      {scrolls ? (
        <ScrollView key={uri} ref={scrollArea} focusable style={{ flex: 1, outlineWidth: 0 }} contentContainerStyle={{ flexGrow: 1 }}>{area}</ScrollView>
      ) : area}
    </View>
  );
}

// Only views on web have focus(); elsewhere this does nothing.
function focus(ref: React.RefObject<unknown>) {
  (ref.current as { focus?(): void } | null)?.focus?.();
}

// Paseo draws dialogs as bottom sheets below this window width.
const COMPACT_BELOW = 720;

// Width left for content: Paseo's 520px dialog less its 24px padding each side.
const CONTENT_WIDTH = 472;
// Characters of 12px monospace per line of the text box (10px padding each side).
const CHARS_PER_LINE = Math.floor((CONTENT_WIDTH - 20) / 7.2);

const FOLDER_ROW_HEIGHT = ATTACHMENT_ROW.lineHeight + ATTACHMENT_ROW.paddingVertical * 2 + ATTACHMENT_ROW.gap;

// Roughly how tall the preview draws, including wrapped lines.
function estimatedHeight(data: { kind: "image" | "video" | "html" } | { kind: "text"; text: string } | { kind: "folder"; entries: unknown[]; truncated: boolean } | undefined, aspectRatio: number, maxMediaHeight: number): number {
  if (!data) return 0;
  if (data.kind === "folder") return Math.max(1, data.entries.length + (data.truncated ? 1 : 0)) * FOLDER_ROW_HEIGHT;
  if (data.kind !== "text") return Math.min(CONTENT_WIDTH / aspectRatio, maxMediaHeight);
  const lines = data.text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0);
  return lines * 18 + 20;
}

// Paseo's smallest text sizes draw no line under 13px: 9px code at 1.45, 10px
// prose at 1.4. Paseo draws every line break in Markdown, so each non-blank line
// takes at least one line.
const MIN_MARKDOWN_LINE = 12;

// The least height a Markdown file can draw at, whatever the user's text size.
export function markdownFloor(markdown: string): number {
  let lines = 0;
  for (const line of markdown.split("\n")) if (line.trim()) lines++;
  return lines * MIN_MARKDOWN_LINE;
}

function FolderList({ colors, folder, entries, truncated, dimmed, onOpen }: { colors: Colors; folder: Attachment; entries: Attachment[]; truncated: boolean; dimmed: boolean; onOpen(attachment: Attachment, group: Attachment[]): void }) {
  const { messages: m } = useProgressLanguage();
  const caption = { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 } as const;
  if (!entries.length) return <Text style={caption}>{m.emptyFolder(folder.title)}</Text>;
  return (
    <View style={{ gap: 8, opacity: dimmed ? 0.6 : 1 }}>
      <AttachmentList colors={colors} attachments={entries} onOpen={onOpen} />
      {truncated ? <Text style={caption}>{m.firstEntries(entries.length)}</Text> : null}
    </View>
  );
}

// An image's pixel width and its width over its height, or nulls if they can't be read.
// Read from the data because onLoad doesn't report a size for data URIs on every platform.
function imageSize(uri: string): Promise<{ width: number | null; ratio: number | null }> {
  return new Promise((resolve) => {
    Image.getSize(uri, (width, height) => resolve(width && height ? { width, ratio: width / height } : { width: null, ratio: null }),
      () => resolve({ width: null, ratio: null }));
  });
}

// Height the dialog has for the preview before it must scroll: Paseo caps the card
// at 85% of the window (inside a 24px margin), less its header and padding, the
// path caption (17px after an 8px gap) and the footer (30px after a 20px gap).
function roomForContent(windowHeight: number): number {
  return (windowHeight - 48) * 0.85 - 57 - 48 - (8 + 17) - (20 + 30);
}

// A dialog footer button: 13px label and 14px icon, 30px tall. Icon-only is a 30px square.
export function DialogButton({ colors, icon, label, accessibilityLabel, onPress, onBlur, outerStyle, ref }: { colors: Colors; icon: string; label?: string; accessibilityLabel?: string; onPress(): void; onBlur?(): void; outerStyle?: ViewStyle; ref?: React.Ref<View> }) {
  return (
    <PressScale ref={ref} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} onBlur={onBlur} outerStyle={outerStyle}
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
export function BackButton({ colors, onPress }: { colors: Colors; onPress(): void }) {
  const { messages: m } = useProgressLanguage();
  return <DialogButton colors={colors} icon="ChevronLeft" label={m.back} onPress={onPress} outerStyle={{ alignSelf: "flex-start" }} />;
}

// Previous and next through a gallery, with "2 of 3" between.
function Stepper({ colors, index, count, onStep, nextRef }: { colors: Colors; index: number; count: number; onStep(offset: number): void; nextRef: React.Ref<View> }) {
  const { messages: m } = useProgressLanguage();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <DialogButton colors={colors} icon="ChevronLeft" accessibilityLabel={m.previousFile} onPress={() => onStep(-1)} />
      <Text style={{ minWidth: 44, textAlign: "center", color: colors.foregroundMuted, fontSize: 13, lineHeight: 18, fontVariant: ["tabular-nums"] }}>{m.galleryPosition(index + 1, count)}</Text>
      <DialogButton ref={nextRef} colors={colors} icon="ChevronRight" accessibilityLabel={m.nextFile} onPress={() => onStep(1)} />
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
