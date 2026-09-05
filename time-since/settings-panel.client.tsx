import { Icon, type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { settingsQueryKey, useSettings } from "./settings.client";
import { updateSettings, type TimeSinceSettings } from "./settings.shared";

export function TimeSinceOptionsPanel({ theme, host }: PluginWorkspacePanelProps) {
  const { colors } = theme;
  const query = useSettings(host.id);
  const queryClient = useQueryClient();
  const saveSettings = useRpc(updateSettings);
  const mutation = useMutation({
    scope: { id: `time-since-settings-${host.id}` },
    mutationFn: (patch: Partial<TimeSinceSettings>) => saveSettings(patch),
    onSuccess: async (settings) => {
      await queryClient.cancelQueries({ queryKey: settingsQueryKey(host.id) });
      queryClient.setQueryData(settingsQueryKey(host.id), settings);
    },
  });
  const settings = query.data;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface0 }}
      contentContainerStyle={{ paddingBottom: 16 }}
    >
      <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text accessibilityRole="header" style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 18 }}>
          Time Since
        </Text>
      </View>

      {!settings && query.isPending ? <ActivityIndicator color={colors.foregroundMuted} accessibilityLabel="Loading options" /> : null}
      {query.isError ? (
        <View style={{ gap: 8, padding: 12 }}>
          <Text accessibilityRole="alert" style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 18, padding: 12 }}>
            Could not load options. Try again.
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void query.refetch()} style={{ paddingVertical: 10 }}>
            <Text style={{ color: colors.accent }}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {settings ? (
        <>
          {([
            ["showIcon", "Show clock icon"],
            ["showAgo", 'Show "ago" suffix'],
          ] as const).map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="switch"
              accessibilityLabel={label}
              accessibilityState={{ checked: settings[key], disabled: mutation.isPending || query.isError }}
              disabled={mutation.isPending || query.isError}
              onPress={() => mutation.mutate({ [key]: !settings[key] })}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                minHeight: 40,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                backgroundColor: pressed ? colors.surface1 : colors.surface0,
                opacity: mutation.isPending ? 0.6 : 1,
              })}
            >
              <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{label}</Text>
              <View style={{
                width: 28,
                height: 16,
                borderRadius: 8,
                padding: 2,
                justifyContent: "center",
                alignItems: settings[key] ? "flex-end" : "flex-start",
                backgroundColor: settings[key] ? colors.accent : colors.surface2,
                borderWidth: settings[key] ? 0 : 1,
                borderColor: colors.border,
              }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: settings[key] ? colors.accentForeground : colors.foregroundMuted }} />
              </View>
            </Pressable>
          ))}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 12, paddingVertical: 12 }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Preview</Text>
            <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
              {settings.showIcon ? <Icon name="Clock" size={14} color={colors.foregroundMuted} /> : null}
              <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16 }}>4m 12s{settings.showAgo ? " ago" : ""}</Text>
            </View>
          </View>
        </>
      ) : null}
      <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, paddingHorizontal: 12, paddingTop: 4 }}>
        {mutation.isPending ? "Saving..." : `All workspaces on ${host.label} · Auto-save`}
      </Text>
      {mutation.isError ? (
        <Text accessibilityRole="alert" style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 18, padding: 12 }}>
          Could not save options. Your previous settings are still shown. Try the toggle again.
        </Text>
      ) : null}
    </ScrollView>
  );
}
