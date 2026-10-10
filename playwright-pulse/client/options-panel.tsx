// Pulse's options, in the same shape as Time Since's: a panel of switches that
// save as soon as they're pressed and apply to every workspace on the host.
import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { updateSettings, type PulseSettings } from "../shared/settings";
import { publishSettings, settingsQueryKey, useSettings } from "./settings";

const OPTIONS: { key: keyof PulseSettings; label: string; detail: string }[] = [
  {
    key: "sidebar",
    label: "Show test runs in the sidebar",
    detail: "Lists each workspace with a Playwright run going at the top of Paseo's sidebar, so you can see it from any workspace. Press one to open its Pulse panel.",
  },
];

export function OptionsPanel({ theme, host }: PluginWorkspacePanelProps) {
  const { colors } = theme;
  const query = useSettings(host.id);
  const queryClient = useQueryClient();
  const save = useRpc(updateSettings);
  const mutation = useMutation({
    scope: { id: `playwright-pulse-settings-${host.id}` },
    mutationFn: (patch: Partial<PulseSettings>) => save(patch),
    onSuccess: async (settings) => {
      publishSettings(settings);
      await queryClient.cancelQueries({ queryKey: settingsQueryKey(host.id) });
      queryClient.setQueryData(settingsQueryKey(host.id), settings);
    },
  });
  const settings = query.data;
  const busy = mutation.isPending || query.isError;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface0 }} contentContainerStyle={{ paddingBottom: 16 }}>
      <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text accessibilityRole="header" style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 18 }}>Playwright Pulse</Text>
      </View>

      {!settings && query.isPending ? <ActivityIndicator color={colors.foregroundMuted} accessibilityLabel="Loading options" style={{ padding: 16 }} /> : null}
      {query.isError ? (
        <View style={{ gap: 8, padding: 12 }}>
          <Text accessibilityRole="alert" style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 18 }}>Could not load the options.</Text>
          <Pressable accessibilityRole="button" onPress={() => void query.refetch()} style={{ alignSelf: "flex-start", paddingVertical: 6 }}>
            <Text style={{ color: colors.accent, fontSize: 13, lineHeight: 18 }}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {settings ? OPTIONS.map(({ key, label, detail }) => (
        <Pressable key={key} accessibilityRole="switch" accessibilityLabel={label} accessibilityHint={detail}
          accessibilityState={{ checked: settings[key], disabled: busy }} disabled={busy}
          onPress={() => mutation.mutate({ [key]: !settings[key] })}
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 12, paddingVertical: 10,
            borderBottomWidth: 1, borderBottomColor: colors.border,
            backgroundColor: pressed ? colors.surface1 : colors.surface0, opacity: mutation.isPending ? 0.6 : 1,
          })}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{label}</Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{detail}</Text>
          </View>
          {/* Held on the label's line. */}
          <View style={{ height: 18, justifyContent: "center" }}>
            <View style={{
              width: 28, height: 16, borderRadius: 8, padding: 2, justifyContent: "center",
              alignItems: settings[key] ? "flex-end" : "flex-start",
              backgroundColor: settings[key] ? colors.accent : colors.surface2,
              borderWidth: settings[key] ? 0 : 1, borderColor: colors.border,
            }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: settings[key] ? colors.accentForeground : colors.foregroundMuted }} />
            </View>
          </View>
        </Pressable>
      )) : null}

      <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, paddingHorizontal: 12, paddingTop: 8 }}>
        {mutation.isPending ? "Saving…" : `All workspaces on ${host.label} · Saves as you change it`}
      </Text>
      {mutation.isError ? (
        <Text accessibilityRole="alert" style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 18, paddingHorizontal: 12, paddingTop: 4 }}>
          Could not save. The switch shows what's still saved; try again.
        </Text>
      ) : null}
    </ScrollView>
  );
}
