import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { Text, View } from "react-native";
import { installReporter, type ReporterStatus } from "../shared/rpc";
import { PressScale, Presence } from "./motion";
import { raised } from "./surfaces";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// What the banner says, or null when Playwright can already load the reporter.
// The plugin writes the copy when it starts and keeps it current, so this only
// shows when that failed or another file is in the way.
export function reporterNotice(status: ReporterStatus): { text: string; action?: string } | null {
  switch (status.state) {
    case "missing":
      return { text: `Pulse couldn't write its reporter to ${status.path}, so test runs aren't recorded.`, action: "Try again" };
    case "foreign":
      return { text: `Something else already exists at ${status.path}, so Pulse won't write its reporter there. Move that file, then come back.` };
    default:
      return null;
  }
}

export function ReporterBanner({ colors, status }: { colors: Colors; status: ReporterStatus | null }) {
  const install = useRpc(installReporter);
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () => install({}),
    onSuccess: (next) => {
      void queryClient.invalidateQueries({ queryKey: ["playwright-pulse", "run"] });
      toast.show(`Pulse's reporter is ready at ${next.path}`, { variant: "success" });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not set up the reporter."),
  });
  const notice = status && !(mutation.isSuccess && status.state === "missing") ? reporterNotice(status) : null;
  return (
    <Presence show={Boolean(notice)}>{notice ? (
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, margin: 12, marginBottom: 0, padding: 8, borderRadius: 12, ...raised(colors), backgroundColor: colors.surface1 }}>
        {/* Held on the first line: the text wraps to several lines in the Explorer pane. */}
        <View style={{ alignSelf: "flex-start", height: 17, justifyContent: "center" }}><Icon name="Plug" size={14} color={colors.foregroundMuted} /></View>
        <Text selectable style={{ flex: 1, minWidth: 200, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{notice.text}</Text>
        {notice.action ? (
          <PressScale accessibilityRole="button" disabled={mutation.isPending} onPress={() => mutation.mutate()}
            style={({ pressed, hovered }) => ({ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, backgroundColor: colors.accent, opacity: pressed || mutation.isPending ? 0.7 : hovered ? 0.85 : 1 })}>
            <Text style={{ color: colors.accentForeground, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>
              {mutation.isPending ? "Writing…" : notice.action}
            </Text>
          </PressScale>
        ) : null}
      </View>
    ) : null}</Presence>
  );
}
