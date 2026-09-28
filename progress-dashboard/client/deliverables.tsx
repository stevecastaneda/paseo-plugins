import { openExternalUrl, type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Deliverable } from "../shared/dashboard";
import { openDeliverable } from "../shared/rpc";
import { imageMimeType } from "../shared/preview";
import { PressScale } from "./motion";
import { PreviewDialog } from "./preview";
import { raised } from "./surfaces";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type Navigation = PluginWorkspacePanelProps["navigation"];

// Full path on the daemon host for a stored path.
export function absolutePath(path: string, workspaceDirectory: string): string {
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return path;
  const base = workspaceDirectory.replace(/[\\/]+$/, "");
  return path === "./" ? `${base}/` : `${base}/${path}`;
}

export function DeliverablesSection({ colors, deliverables, workspaceId, workspaceDirectory, navigation }: {
  colors: Colors;
  deliverables: Deliverable[];
  workspaceId: string;
  workspaceDirectory: string;
  navigation: Navigation;
}) {
  const toast = useToast();
  const openOnHostRpc = useRpc(openDeliverable);
  const [previewing, setPreviewing] = useState<Deliverable | null>(null);
  async function copyPath(deliverable: Deliverable, prefix = "") {
    try {
      await copyText(absolutePath(deliverable.path!, workspaceDirectory));
      toast.show(`${prefix}Copied path`, { variant: prefix ? "warning" : "success" });
    } catch {
      toast.error("Could not copy. Select the path and use Copy.");
    }
  }
  // Web links open in Paseo's browser. Paseo 0.9 plugins can't open local
  // files in the app, so the daemon host opens them with their default app.
  async function open(deliverable: Deliverable) {
    if (deliverable.url) {
      try {
        if (navigation?.openBrowser) navigation.openBrowser({ url: deliverable.url, workspaceId });
        else await openExternalUrl(deliverable.url);
      } catch {
        toast.error("Could not open this link.");
      }
      return;
    }
    // Screenshots preview inside Paseo; everything else opens in its own app.
    if (deliverable.path && imageMimeType(deliverable.path)) {
      setPreviewing(deliverable);
      return;
    }
    await openOnHost(deliverable);
  }
  async function openOnHost(deliverable: Deliverable) {
    try {
      await openOnHostRpc({ workspaceId, workspaceDirectory, deliverableId: deliverable.id });
      toast.show(`Opened ${deliverable.title}`, { variant: "success" });
    } catch (error) {
      await copyPath(deliverable, `${error instanceof Error ? error.message : "Could not open it"}. `);
    }
  }
  return (
    <View style={{ margin: 12, marginBottom: 0, ...raised(colors), borderRadius: 6, overflow: "hidden" }}>
      <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600", paddingHorizontal: 10, paddingVertical: 8 }}>
        Latest deliverables
      </Text>
      {deliverables.map((deliverable) => (
        <Pressable key={deliverable.id} accessibilityRole={deliverable.url ? "link" : "button"}
          accessibilityLabel={`Open ${deliverable.title}`}
          onPress={() => void open(deliverable)}
          style={({ pressed }) => ({ flexDirection: "row", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: pressed ? colors.surface1 : "transparent" })}>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <Text style={{ color: colors.accent, fontSize: 13, lineHeight: 18, textDecorationLine: "underline" }}>{deliverable.title}</Text>
            <Text selectable numberOfLines={1} ellipsizeMode="head" style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
              {deliverable.url ?? deliverable.path}
            </Text>
            {deliverable.ticketLabel || deliverable.kind ? (
              <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16, opacity: 0.8 }}>
                {[deliverable.ticketLabel ?? deliverable.ticketId, deliverable.kind === "link" ? null : deliverable.kind].filter(Boolean).join(", ")}
              </Text>
            ) : null}
          </View>
          {deliverable.path ? (
            <PressScale accessibilityRole="button" accessibilityLabel={`Copy the path of ${deliverable.title}`} hitSlop={6}
              onPress={() => void copyPath(deliverable)}
              style={({ pressed }) => ({ padding: 4, borderRadius: 4, backgroundColor: pressed ? colors.surface2 : "transparent" })}>
              <Icon name="Copy" size={14} color={colors.foregroundMuted} />
            </PressScale>
          ) : (
            <Icon name="ExternalLink" size={14} color={colors.foregroundMuted} />
          )}
        </Pressable>
      ))}
      <PreviewDialog colors={colors} deliverable={previewing} workspaceId={workspaceId} workspaceDirectory={workspaceDirectory}
        onClose={() => setPreviewing(null)} onOpenOnHost={(deliverable) => void openOnHost(deliverable)} />
    </View>
  );
}
