import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { Text, View } from "react-native";
import { PressScale, Presence } from "./motion";
import { raised } from "./surfaces";
import { getLauncherStatus, getSkillStatus, installLauncher, installSkill, type LauncherStatus, type SkillStatus } from "../shared/rpc";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

export function launcherQueryKey(hostId: string) {
  return ["progress", "launcher", hostId];
}

export function skillQueryKey(hostId: string) {
  return ["progress", "skill", hostId];
}

// What the banner says, or null when agents can already run the command.
export function launcherNotice(status: LauncherStatus): { text: string; action?: string } | null {
  switch (status.state) {
    case "missing":
      return { text: `Agents record progress with the paseo-progress command, which isn't installed yet. Installing adds one file: ${status.path}`, action: "Install command" };
    case "outdated":
      return { text: `An older paseo-progress command is installed at ${status.path}.`, action: "Update command" };
    case "foreign":
      return { text: `Something else already exists at ${status.path}, so the plugin won't install there. The README shows how to install it elsewhere.` };
    case "current":
      return status.onPath ? null : { text: `paseo-progress is installed, but its folder isn't on the PATH Paseo uses, so agents need the full path: ${status.path}` };
  }
}

// What the skill banner says, or null when every agent folder has the skill.
export function skillNotice(status: SkillStatus): { text: string; action?: string } | null {
  const folders = (state: string) => status.targets.filter((target) => target.state === state).map((target) => target.path.replace(/\/paseo-progress$/, ""));
  const skipped = folders("foreign").length ? ` Something else is already at ${folders("foreign").join(", ")}, so the plugin leaves it alone.` : "";
  switch (status.state) {
    case "missing":
      return { text: `Agents learn when to record progress from the paseo-progress skill, which isn't installed yet. Installing adds a link in ${folders("missing").join(", ")}.${skipped}`, action: "Install skill" };
    case "outdated":
      return { text: `The paseo-progress skill in ${folders("outdated").join(", ")} points to a copy of the plugin Paseo no longer runs.${skipped}`, action: "Update skill" };
    case "foreign":
      return { text: `Something else already exists at every paseo-progress skill path, so the plugin won't install the skill.` };
    case "current":
      return null;
  }
}

// Nothing is written until the user presses the button.
export function LauncherBanner({ colors, host }: { colors: Colors; host: PluginWorkspacePanelProps["host"] }) {
  const fetchStatus = useRpc(getLauncherStatus);
  const install = useRpc(installLauncher);
  const queryClient = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: launcherQueryKey(host.id), queryFn: () => fetchStatus({}), staleTime: 60_000 });
  const mutation = useMutation({
    mutationFn: () => install({}),
    onSuccess: (next) => {
      queryClient.setQueryData(launcherQueryKey(host.id), next);
      toast.show(`Installed paseo-progress at ${next.path}`, { variant: "success" });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not install the command."),
  });
  const notice = status.data ? launcherNotice(status.data) : null;
  return <SetupBanner colors={colors} icon="Terminal" notice={notice} pending={mutation.isPending} onPress={() => mutation.mutate()} />;
}

export function SkillBanner({ colors, host }: { colors: Colors; host: PluginWorkspacePanelProps["host"] }) {
  const fetchStatus = useRpc(getSkillStatus);
  const install = useRpc(installSkill);
  const queryClient = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: skillQueryKey(host.id), queryFn: () => fetchStatus({}), staleTime: 60_000 });
  const mutation = useMutation({
    mutationFn: () => install({}),
    onSuccess: (next) => {
      queryClient.setQueryData(skillQueryKey(host.id), next);
      toast.show("Installed the paseo-progress skill. New agent sessions will use it.", { variant: "success" });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not install the skill."),
  });
  const notice = status.data ? skillNotice(status.data) : null;
  return <SetupBanner colors={colors} icon="Sparkles" notice={notice} pending={mutation.isPending} onPress={() => mutation.mutate()} />;
}

function SetupBanner({ colors, icon, notice, pending, onPress }: {
  colors: Colors;
  icon: string;
  notice: { text: string; action?: string } | null;
  pending: boolean;
  onPress(): void;
}) {
  return (
    <Presence show={Boolean(notice)}>{notice ? (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, margin: 12, marginBottom: 0, padding: 8, borderRadius: 12, ...raised(colors), backgroundColor: colors.surface1 }}>
      {/* Held on the first line: the text wraps to several lines in the Explorer pane. */}
      <View style={{ alignSelf: "flex-start", height: 17, justifyContent: "center" }}><Icon name={icon} size={14} color={colors.foregroundMuted} /></View>
      <Text selectable style={{ flex: 1, minWidth: 200, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{notice.text}</Text>
      {notice.action ? (
        <PressScale accessibilityRole="button" disabled={pending} onPress={onPress}
          style={({ pressed, hovered }) => ({ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, backgroundColor: colors.accent, opacity: pressed || pending ? 0.7 : hovered ? 0.85 : 1 })}>
          <Text style={{ color: colors.accentForeground, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>
            {pending ? "Installing…" : notice.action}
          </Text>
        </PressScale>
      ) : null}
    </View>
    ) : null}</Presence>
  );
}
