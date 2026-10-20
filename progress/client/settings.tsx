import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import React from "react";
import { Text } from "react-native";
import type { QuestionMode } from "../shared/events";
import { questionSettings } from "../shared/settings";

const MODES = [
  { label: "Stop and ask", value: "stop" },
  { label: "Keep building", value: "build" },
] as const;

const HINTS: Record<QuestionMode, string> = {
  stop: "Agents build nothing a question affects until you answer.",
  build: "Agents build their recommended option while you decide, and change course if you pick another. Big questions still wait.",
};

export function QuestionSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(questionSettings);
  const muted = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 };
  if (settings.status === "loading") return <Text style={muted}>Loading settings…</Text>;
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Questions">
        <Text style={muted}>{settings.error}</Text>
        <SettingsCard>
          <SettingsAction label="Try again" actionLabel="Reload" onPress={settings.reload} />
          {settings.status === "invalid" ? <SettingsAction label="Go back to Stop and ask" actionLabel="Reset" onPress={settings.reset} /> : null}
        </SettingsCard>
      </SettingsSection>
    );
  }
  return (
    <SettingsSection title="Questions">
      <SettingsCard>
        <SettingsSelect
          label="While a question waits for you"
          hint={HINTS[settings.values.mode]}
          error={settings.saveError}
          value={settings.values.mode}
          options={MODES}
          disabled={settings.saving}
          onValueChange={(mode) => void settings.save({ ...settings.values, mode }, settings.revision)}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
