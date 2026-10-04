import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";
import { previewAttachment } from "../shared/rpc";
import { PressScale, useLastPresent } from "./motion";
import { imageOutline, raised } from "./surfaces";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

export type ScreenshotRef = { runId: string; testId: string; index: number; title: string; path: string };

// A failure screenshot in a dialog, with a way out to the host's own app.
export function ScreenshotDialog({ colors, shot, workspaceId, workspaceDirectory, onClose, onOpenOnHost }: {
  colors: Colors;
  shot: ScreenshotRef | null;
  workspaceId: string;
  workspaceDirectory: string;
  onClose(): void;
  onOpenOnHost(shot: ScreenshotRef): void;
}) {
  const open = Boolean(shot);
  // Keeps the image while the dialog animates closed.
  const shown = useLastPresent(shot);
  return (
    <Modal title={shown?.title ?? "Screenshot"} icon={<Icon name="Image" size={16} color={colors.foregroundMuted} />}
      open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Modal.Content>
        {shown ? <ScreenshotBody colors={colors} shot={shown} workspaceId={workspaceId} workspaceDirectory={workspaceDirectory}
          onOpenOnHost={() => { onClose(); onOpenOnHost(shown); }} /> : null}
      </Modal.Content>
    </Modal>
  );
}

function ScreenshotBody({ colors, shot, workspaceId, workspaceDirectory, onOpenOnHost }: {
  colors: Colors;
  shot: ScreenshotRef;
  workspaceId: string;
  workspaceDirectory: string;
  onOpenOnHost(): void;
}) {
  const fetchPreview = useRpc(previewAttachment);
  const preview = useQuery({
    // The path too: a retry's screenshot sits at the same position.
    queryKey: ["playwright-pulse", "screenshot", workspaceId, shot.runId, shot.testId, shot.index, shot.path],
    queryFn: () => fetchPreview({ workspaceId, workspaceDirectory, runId: shot.runId, testId: shot.testId, index: shot.index, path: shot.path }),
    staleTime: 60_000,
    // Images arrive as data URIs; let them go soon after the dialog closes.
    gcTime: 30_000,
  });
  // Screenshots vary from phone-tall to full-width; size to the real image.
  const [ratio, setRatio] = useState(16 / 10);
  const uri = preview.data?.dataUri ?? null;
  useEffect(() => {
    if (!uri) return;
    let current = true;
    Image.getSize(uri, (width, height) => { if (current && width && height) setRatio(width / height); }, () => {});
    return () => { current = false; };
  }, [uri]);
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 12 }}>
        {preview.isPending ? <ActivityIndicator color={colors.foregroundMuted} accessibilityLabel="Loading screenshot" style={{ padding: 24 }} /> : null}
        {preview.error ? (
          <Text accessibilityRole="alert" selectable style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 18 }}>
            Could not show it: {preview.error.message}
          </Text>
        ) : null}
        {uri ? (
          <Image accessibilityLabel={shot.title} source={{ uri }} resizeMode="contain"
            style={{ width: "100%", aspectRatio: ratio, maxHeight: 640, borderRadius: 6, ...imageOutline(colors), backgroundColor: colors.surface1 }} />
        ) : null}
        <Text selectable numberOfLines={1} ellipsizeMode="middle" style={{ marginTop: -4, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          {shot.path}
        </Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <PressScale accessibilityRole="button" accessibilityLabel="Open in its default app" onPress={onOpenOnHost}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingStart: 8, paddingEnd: 10, borderRadius: 6, ...raised(colors), backgroundColor: pressed ? colors.surface1 : colors.surface2 })}>
          <Icon name="ExternalLink" size={14} color={colors.foreground} />
          <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>Open</Text>
        </PressScale>
      </View>
    </View>
  );
}
