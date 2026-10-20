import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import React from "react";
import { Text } from "react-native";
import { DEFAULT_QUESTION_MODE, QUESTION_MODE_RULES, QUESTION_MODES } from "../shared/question-modes";
import { questionSettings } from "../shared/settings";

const OPTIONS = QUESTION_MODES.map((value) => ({ label: QUESTION_MODE_RULES[value].label, value }));

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
          {settings.status === "invalid" ? <SettingsAction label={`Go back to ${QUESTION_MODE_RULES[DEFAULT_QUESTION_MODE].label}`} actionLabel="Reset" onPress={settings.reset} /> : null}
        </SettingsCard>
      </SettingsSection>
    );
  }
  return (
    <SettingsSection title="Questions">
      <SettingsCard>
        <SettingsSelect
          label="When an agent asks you a question"
          hint={QUESTION_MODE_RULES[settings.values.mode].hint}
          error={settings.saveError}
          value={settings.values.mode}
          options={OPTIONS}
          disabled={settings.saving}
          onValueChange={(mode) => void settings.save({ ...settings.values, mode }, settings.revision)}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
