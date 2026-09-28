import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { ActivityIndicator, Image, Platform, Text, useWindowDimensions, View } from "react-native";
import { type Attachment, attachmentIcon } from "./attachments";
import { previewDeliverable } from "../shared/rpc";
import { PressScale, useLastPresent } from "./motion";
import { imageOutline, raised } from "./surfaces";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// An image or text attachment shown in a dialog, with a way out to the host's own app.
// `onBack` returns to where the preview was opened from, e.g. a question's dialog.
export function PreviewDialog({ colors, attachment, workspaceId, workspaceDirectory, onClose, onOpenOnHost, backLabel, onBack }: {
  colors: Colors;
  attachment: Attachment | null;
  workspaceId: string;
  workspaceDirectory: string;
  onClose(): void;
  onOpenOnHost(attachment: Attachment): void;
  backLabel?: string;
  onBack?(): void;
}) {
  const open = Boolean(attachment);
  attachment = useLastPresent(attachment);
  return (
    <Modal title={attachment?.title ?? "Preview"} icon={<Icon name={attachment ? attachmentIcon(attachment) : "FileText"} size={16} color={colors.foregroundMuted} />}
      open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      {attachment ? (
        <PreviewBody colors={colors} attachment={attachment} workspaceId={workspaceId} workspaceDirectory={workspaceDirectory}
          onOpenOnHost={() => { onClose(); onOpenOnHost(attachment); }} backLabel={backLabel} onBack={onBack} />
      ) : <Modal.Content>{null}</Modal.Content>}
    </Modal>
  );
}

// The preview dialog's body as its own Modal.Content, so another dialog can show it in place.
export function PreviewBody({ colors, attachment, workspaceId, workspaceDirectory, onOpenOnHost, backLabel, onBack }: {
  colors: Colors;
  attachment: Attachment;
  workspaceId: string;
  workspaceDirectory: string;
  onOpenOnHost(): void;
  backLabel?: string;
  onBack?(): void;
}) {
  const fetchPreview = useRpc(previewDeliverable);
  const preview = useQuery({
    queryKey: ["progress-dashboard", "preview", workspaceId, attachment.ref, attachment.path],
    queryFn: () => fetchPreview({ workspaceId, workspaceDirectory, ref: attachment.ref }),
    staleTime: 30_000,
  });
  // Screenshots vary from phone-tall to full-width; size to the real image once it loads.
  const [aspectRatio, setAspectRatio] = useState(16 / 10);
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
        <View style={{ padding: 10, borderRadius: 6, backgroundColor: colors.surface0 }}>
          <Text selectable style={{ color: colors.foreground, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, lineHeight: 18 }}>
            {preview.data.text}
          </Text>
          {preview.data.truncated ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16, paddingTop: 8 }}>
              Showing the first 256 KB. Open it in its default app for the rest.
            </Text>
          ) : null}
        </View>
      ) : null}
      {preview.data?.kind === "image" ? (
        <Image accessibilityLabel={attachment.title} source={{ uri: preview.data.dataUri }} resizeMode="contain"
          onLoad={(event) => {
            const { width, height } = event.nativeEvent.source ?? {};
            if (width && height) setAspectRatio(width / height);
          }}
          style={{ width: "100%", aspectRatio, maxHeight: 640, borderRadius: 6, ...imageOutline(colors), backgroundColor: colors.surface1 }} />
      ) : null}
    </>
  );
  const actions = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {onBack ? <BackButton colors={colors} label={backLabel ?? "Back"} onPress={onBack} /> : null}
      <Text selectable numberOfLines={1} ellipsizeMode="head" style={{ flex: 1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
        {attachment.path}
      </Text>
      <PressScale accessibilityRole="button" onPress={onOpenOnHost}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 6, paddingRight: 8, paddingVertical: 4, borderRadius: 6, ...raised(colors), backgroundColor: pressed ? colors.surface1 : colors.surface2 })}>
        <Icon name="ExternalLink" size={12} color={colors.foreground} />
        <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 16 }}>Open in default app</Text>
      </PressScale>
    </View>
  );
  return long ? (
    <Modal.Content scrollable={false}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12 }}>{content}</ScrollView>
      {actions}
    </Modal.Content>
  ) : (
    <Modal.Content>
      <View style={{ gap: 12 }}>
        {content}
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
// at 85% of the window (inside a 24px margin), less its header, padding and our actions.
function roomForContent(windowHeight: number): number {
  return (windowHeight - 48) * 0.85 - 57 - 48 - 16 - 30;
}

// Returns to the dialog this one was opened from. For surface1 dialogs.
export function BackButton({ colors, label, onPress }: { colors: Colors; label: string; onPress(): void }) {
  return (
    <PressScale accessibilityRole="button" onPress={onPress} outerStyle={{ alignSelf: "flex-start" }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 6, paddingRight: 8, paddingVertical: 4, borderRadius: 6, ...raised(colors), backgroundColor: pressed ? colors.surface1 : colors.surface2 })}>
      <Icon name="ChevronLeft" size={12} color={colors.foreground} />
      <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 16 }}>{label}</Text>
    </PressScale>
  );
}
