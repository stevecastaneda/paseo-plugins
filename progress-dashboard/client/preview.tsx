import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";
import type { Deliverable } from "../shared/dashboard";
import { previewDeliverable } from "../shared/rpc";
import { PressScale, useLastPresent } from "./motion";
import { imageOutline, raised } from "./surfaces";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// A screenshot deliverable shown in a dialog, with a way out to the host's own app.
export function PreviewDialog({ colors, deliverable, workspaceId, workspaceDirectory, onClose, onOpenOnHost }: {
  colors: Colors;
  deliverable: Deliverable | null;
  workspaceId: string;
  workspaceDirectory: string;
  onClose(): void;
  onOpenOnHost(deliverable: Deliverable): void;
}) {
  const open = Boolean(deliverable);
  deliverable = useLastPresent(deliverable);
  return (
    <Modal title={deliverable?.title ?? "Preview"} icon={<Icon name="Image" size={16} color={colors.foregroundMuted} />}
      open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Modal.Content>
        {deliverable ? (
          <PreviewBody colors={colors} deliverable={deliverable} workspaceId={workspaceId} workspaceDirectory={workspaceDirectory}
            onOpenOnHost={() => { onClose(); onOpenOnHost(deliverable); }} />
        ) : null}
      </Modal.Content>
    </Modal>
  );
}

function PreviewBody({ colors, deliverable, workspaceId, workspaceDirectory, onOpenOnHost }: {
  colors: Colors;
  deliverable: Deliverable;
  workspaceId: string;
  workspaceDirectory: string;
  onOpenOnHost(): void;
}) {
  const fetchPreview = useRpc(previewDeliverable);
  const preview = useQuery({
    queryKey: ["progress-dashboard", "preview", workspaceId, deliverable.id, deliverable.path],
    queryFn: () => fetchPreview({ workspaceId, workspaceDirectory, deliverableId: deliverable.id }),
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
      {preview.data ? (
        <Image accessibilityLabel={deliverable.title} source={{ uri: preview.data.dataUri }} resizeMode="contain"
          onLoad={(event) => {
            const { width, height } = event.nativeEvent.source ?? {};
            if (width && height) setAspectRatio(width / height);
          }}
          style={{ width: "100%", aspectRatio, maxHeight: 640, borderRadius: 6, ...imageOutline(colors), backgroundColor: colors.surface1 }} />
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text selectable numberOfLines={1} ellipsizeMode="head" style={{ flex: 1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          {deliverable.path}
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
