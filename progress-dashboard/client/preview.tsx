import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { ActivityIndicator, Image, Platform, Text, View } from "react-native";
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
      <Modal.Content>
        {attachment ? (
          <PreviewBody colors={colors} attachment={attachment} workspaceId={workspaceId} workspaceDirectory={workspaceDirectory}
            onOpenOnHost={() => { onClose(); onOpenOnHost(attachment); }} backLabel={backLabel} onBack={onBack} />
        ) : null}
      </Modal.Content>
    </Modal>
  );
}

function PreviewBody({ colors, attachment, workspaceId, workspaceDirectory, onOpenOnHost, backLabel, onBack }: {
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
  return (
    <View style={{ gap: 12 }}>
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
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {onBack ? (
          <PressScale accessibilityRole="button" onPress={onBack}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 6, paddingRight: 8, paddingVertical: 4, borderRadius: 6, ...raised(colors), backgroundColor: pressed ? colors.surface1 : colors.surface2 })}>
            <Icon name="ChevronLeft" size={12} color={colors.foreground} />
            <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 16 }}>{backLabel ?? "Back"}</Text>
          </PressScale>
        ) : null}
        <Text selectable numberOfLines={1} ellipsizeMode="head" style={{ flex: 1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          {attachment.path}
        </Text>
        <PressScale accessibilityRole="button" onPress={onOpenOnHost}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 6, paddingRight: 8, paddingVertical: 4, borderRadius: 6, ...raised(colors), backgroundColor: pressed ? colors.surface1 : colors.surface2 })}>
          <Icon name="ExternalLink" size={12} color={colors.foreground} />
          <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 16 }}>Open in default app</Text>
        </PressScale>
      </View>
    </View>
  );
}
