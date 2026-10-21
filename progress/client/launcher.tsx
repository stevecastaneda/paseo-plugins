import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { Text, View } from "react-native";
import { PressScale, Presence } from "./motion";
import { raised } from "./surfaces";
import { getLauncherStatus, getSkillStatus, installLauncher, installSkill, type LauncherStatus, type SkillStatus } from "../shared/rpc";
import { messagesFor, type ProgressMessages } from "./i18n";
import { errorText } from "./errors";
import { useProgressLanguage } from "./language";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

export function launcherQueryKey(hostId: string) {
  return ["progress", "launcher", hostId];
}

export function skillQueryKey(hostId: string) {
  return ["progress", "skill", hostId];
}

// What the banner says, or null when agents can already run the command.
export function launcherNotice(status: LauncherStatus, m: ProgressMessages = messagesFor("en")): { text: string; action?: string } | null {
  switch (status.state) {
    case "missing":
      return { text: m.launcherMissing(status.path), action: m.installCommand };
    case "outdated":
      return { text: m.launcherOutdated(status.path), action: m.updateCommand };
    case "foreign":
      return { text: m.launcherForeign(status.path) };
    case "current":
      return status.onPath ? null : { text: m.launcherOffPath(status.path) };
  }
}

// What the skill banner says, or null when every agent folder has the skill.
export function skillNotice(status: SkillStatus, m: ProgressMessages = messagesFor("en")): { text: string; action?: string } | null {
  const folders = (state: string) => status.targets.filter((target) => target.state === state).map((target) => target.path.replace(/[\\/]paseo-progress$/, ""));
  const skipped = folders("foreign").length ? m.skillSkipped(folders("foreign").join(", ")) : "";
  switch (status.state) {
    case "missing":
      return { text: m.skillMissing(folders("missing").join(", "), skipped), action: m.installSkill };
    case "outdated":
      return { text: m.skillOutdated(folders("outdated").join(", "), skipped), action: m.updateSkill };
    case "foreign":
      return { text: m.skillForeign };
    case "current":
      return null;
  }
}

// Nothing is written until the user presses the button.
export function LauncherBanner({ colors, host }: { colors: Colors; host: PluginWorkspacePanelProps["host"] }) {
  const { messages: m } = useProgressLanguage();
  const fetchStatus = useRpc(getLauncherStatus);
  const install = useRpc(installLauncher);
  const queryClient = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: launcherQueryKey(host.id), queryFn: () => fetchStatus({}), staleTime: 60_000 });
  const mutation = useMutation({
    mutationFn: () => install({}),
    onSuccess: (next) => {
      queryClient.setQueryData(launcherQueryKey(host.id), next);
      toast.show(m.launcherInstalled(next.path), { variant: "success" });
    },
    onError: (error) => toast.error(errorText(error, m.installCommandFailure)),
  });
  const notice = status.data ? launcherNotice(status.data, m) : null;
  return <SetupBanner colors={colors} icon="Terminal" notice={notice} pending={mutation.isPending} onPress={() => mutation.mutate()} />;
}

export function SkillBanner({ colors, host }: { colors: Colors; host: PluginWorkspacePanelProps["host"] }) {
  const { messages: m } = useProgressLanguage();
  const fetchStatus = useRpc(getSkillStatus);
  const install = useRpc(installSkill);
  const queryClient = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: skillQueryKey(host.id), queryFn: () => fetchStatus({}), staleTime: 60_000 });
  const mutation = useMutation({
    mutationFn: () => install({}),
    onSuccess: (next) => {
      queryClient.setQueryData(skillQueryKey(host.id), next);
      toast.show(m.skillInstalled, { variant: "success" });
    },
    onError: (error) => toast.error(errorText(error, m.installSkillFailure)),
  });
  const notice = status.data ? skillNotice(status.data, m) : null;
  return <SetupBanner colors={colors} icon="Sparkles" notice={notice} pending={mutation.isPending} onPress={() => mutation.mutate()} />;
}

function SetupBanner({ colors, icon, notice, pending, onPress }: {
  colors: Colors;
  icon: string;
  notice: { text: string; action?: string } | null;
  pending: boolean;
  onPress(): void;
}) {
  const { messages: m } = useProgressLanguage();
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
            {pending ? m.installing : notice.action}
          </Text>
        </PressScale>
      ) : null}
    </View>
    ) : null}</Presence>
  );
}
