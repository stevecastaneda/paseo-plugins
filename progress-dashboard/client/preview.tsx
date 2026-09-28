import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Platform, Text, useWindowDimensions, View, type ViewStyle } from "react-native";
import { type Attachment, attachmentIcon, isPreviewable } from "./attachments";
import { previewDeliverable } from "../shared/rpc";
import { PressScale, useLastPresent } from "./motion";
import { imageOutline, raised } from "./surfaces";

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

// The preview dialog's body as its own Modal.Content, so another dialog can show it in place.
export function PreviewBody({ colors, attachment, workspaceId, workspaceDirectory, onOpenOnHost, backLabel, onBack, gallery }: {
  colors: Colors;
  attachment: Attachment;
  workspaceId: string;
  workspaceDirectory: string;
  onOpenOnHost(): void;
  backLabel?: string;
  onBack?(): void;
  gallery?: Gallery;
}) {
  const fetchPreview = useRpc(previewDeliverable);
  const previewQuery = (target: Attachment) => ({
    queryKey: ["progress-dashboard", "preview", workspaceId, target.ref, target.path],
    queryFn: () => fetchPreview({ workspaceId, workspaceDirectory, ref: target.ref }),
    staleTime: 30_000,
  });
  // Stepping to another file keeps this one on screen (dimmed) until the next loads,
  // so the dialog doesn't collapse to a spinner and back.
  const preview = useQuery({ ...previewQuery(attachment), placeholderData: (previous) => previous });
  const stepping = preview.isPlaceholderData;
  // Measure the image from its data rather than waiting on onLoad, which doesn't
  // report a size for data URIs on every platform; without it the box stays 16:10.
  const imageUri = !stepping && preview.data?.kind === "image" ? preview.data.dataUri : null;
  useEffect(() => {
    if (!imageUri) return;
    let current = true;
    Image.getSize(imageUri, (width, height) => {
      if (current && width && height) setMeasured({ ref: attachment.ref, ratio: width / height });
    }, () => {});
    return () => { current = false; };
  }, [imageUri, attachment.ref]);
  // Load the files either side ahead of time, so Previous and Next are instant.
  const queryClient = useQueryClient();
  const items = gallery?.items ?? [];
  const index = items.findIndex((item) => item.ref === attachment.ref);
  useEffect(() => {
    if (index < 0 || items.length < 2) return;
    for (const step of [1, -1]) void queryClient.prefetchQuery(previewQuery(items[(index + step + items.length) % items.length]));
  }, [attachment.ref, items.length]);
  // Screenshots vary from phone-tall to full-width; size to the real image once it loads.
  // Kept per file, so stepping to the next image doesn't borrow this one's shape.
  const [measured, setMeasured] = useState<{ ref: string; ratio: number } | null>(null);
  const aspectRatio = measured && (measured.ref === attachment.ref || stepping) ? measured.ratio : 16 / 10;
  // A long file gets its own scroll area so the actions below it stay in view.
  // Short ones keep the dialog sized to them.
  const { height: windowHeight } = useWindowDimensions();
  const long = estimatedHeight(preview.data, aspectRatio) > roomForContent(windowHeight);
  const content = (
    <>
      {preview.isPending ? <ActivityIndicator color={colors.foregroundMuted} accessibilityLabel="Loading preview" style={{ padding: 24 }} /> : null}
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
        <Image accessibilityLabel={attachment.title} source={{ uri: preview.data.dataUri }} resizeMode="contain"
          onLoad={(event) => {
            const { width, height } = event.nativeEvent.source ?? {};
            if (width && height && !stepping) setMeasured({ ref: attachment.ref, ratio: width / height });
          }}
          style={{ width: "100%", aspectRatio, maxHeight: 640, borderRadius: 6, ...imageOutline(colors), backgroundColor: colors.surface1, opacity: stepping ? 0.6 : 1 }} />
      ) : null}
      {/* The path as a caption under the file, where it has the full width. */}
      <Text selectable numberOfLines={1} ellipsizeMode="middle" style={{ marginTop: -4, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
        {attachment.path}
      </Text>
    </>
  );
  // Back on the left, Previous and Next in the middle, Open on the right.
  const actions = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1, alignItems: "flex-start" }}>
        {onBack ? <BackButton colors={colors} label={backLabel ?? "Back"} onPress={onBack} /> : null}
      </View>
      {gallery && gallery.items.length > 1 ? <Stepper colors={colors} gallery={gallery} current={attachment} /> : null}
      <View style={{ flex: 1, alignItems: "flex-end" }}>
        <DialogButton colors={colors} icon="ExternalLink" label="Open" accessibilityLabel="Open in its default app" onPress={onOpenOnHost} />
      </View>
    </View>
  );
  return long ? (
    <Modal.Content scrollable={false}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12 }}>{content}</ScrollView>
      {actions}
    </Modal.Content>
  ) : (
    <Modal.Content>
      <View style={{ gap: 20 }}>
        <View style={{ gap: 12 }}>{content}</View>
        {actions}
      </View>
    </Modal.Content>
  );
}

// Width left for content: Paseo's 520px dialog less its 24px padding each side.
const CONTENT_WIDTH = 472;
// Characters of 12px monospace per line of the text box (10px padding each side).
const CHARS_PER_LINE = Math.floor((CONTENT_WIDTH - 20) / 7.2);

// Roughly how tall the preview draws, including wrapped lines.
function estimatedHeight(data: { kind: "image" } | { kind: "text"; text: string } | undefined, aspectRatio: number): number {
  if (!data) return 0;
  if (data.kind === "image") return Math.min(CONTENT_WIDTH / aspectRatio, 640);
  const lines = data.text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0);
  return lines * 18 + 20;
}

// Height the dialog has for the preview before it must scroll: Paseo caps the card
// at 85% of the window (inside a 24px margin), less its header and padding, the
// path caption (17px after an 8px gap) and the footer (30px after a 20px gap).
function roomForContent(windowHeight: number): number {
  return (windowHeight - 48) * 0.85 - 57 - 48 - (8 + 17) - (20 + 30);
}

// A dialog footer button: 13px label and 14px icon, 30px tall. Icon-only is a 30px square.
export function DialogButton({ colors, icon, label, accessibilityLabel, onPress, outerStyle }: { colors: Colors; icon: string; label?: string; accessibilityLabel?: string; onPress(): void; outerStyle?: ViewStyle }) {
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} outerStyle={outerStyle}
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

// Previous and next through a gallery, wrapping at the ends, with "2 of 3" between.
function Stepper({ colors, gallery, current }: { colors: Colors; gallery: Gallery; current: Attachment }) {
  const { items } = gallery;
  const index = Math.max(0, items.findIndex((item) => item.ref === current.ref));
  const go = (step: number) => gallery.onSelect(items[(index + step + items.length) % items.length]);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <DialogButton colors={colors} icon="ChevronLeft" accessibilityLabel="Previous file" onPress={() => go(-1)} />
      <Text style={{ minWidth: 44, textAlign: "center", color: colors.foregroundMuted, fontSize: 13, lineHeight: 18, fontVariant: ["tabular-nums"] }}>{index + 1} of {items.length}</Text>
      <DialogButton colors={colors} icon="ChevronRight" accessibilityLabel="Next file" onPress={() => go(1)} />
    </View>
  );
}
