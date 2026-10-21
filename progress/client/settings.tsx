import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import React from "react";
import { Text } from "react-native";
import { DEFAULT_QUESTION_MODE, QUESTION_MODES } from "../shared/question-modes";
import { questionSettings, LANGUAGE_PREFERENCES } from "../shared/settings";
import { useProgressLanguage } from "./language";

export function QuestionSettings({ theme }: PluginSurfaceProps) {
  return <><QuestionModeSettings theme={theme} /><DisplaySettings theme={theme} /></>;
}

type Colors = PluginSurfaceProps["theme"]["colors"];

function DisplaySettings({ theme }: Pick<PluginSurfaceProps, "theme">) {
  const { messages: m, settings } = useProgressLanguage();
  const muted = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 };
  const options = LANGUAGE_PREFERENCES.map((value) => ({ value, label: value === "system" ? m.systemLanguage : value === "en" ? "English" : "简体中文" }));
  return (
    <SettingsSection title={m.display}>
      {settings.status === "loading" ? <Text style={muted}>{m.loadingSettings}</Text>
        : settings.status !== "ready" ? <SettingsRecovery colors={theme.colors} settings={settings} />
        : <SettingsCard><SettingsSelect label={m.language} hint={m.languageHint} value={settings.values.language} options={options}
          disabled={settings.saving} error={settings.saveError}
          onValueChange={(language) => void settings.save({ ...settings.values, language }, settings.revision)} /></SettingsCard>}
    </SettingsSection>
  );
}

function QuestionModeSettings({ theme }: Pick<PluginSurfaceProps, "theme">) {
  const { messages: m } = useProgressLanguage();
  const settings = useSettings(questionSettings);
  const muted = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 };
  return (
    <SettingsSection title={m.questions}>
      {settings.status === "loading" ? <Text style={muted}>{m.loadingSettings}</Text>
        : settings.status !== "ready" ? <SettingsRecovery colors={theme.colors} settings={settings} resetLabel={m.resetTo(m.questionModes[DEFAULT_QUESTION_MODE].label)} />
        : <SettingsCard><SettingsSelect label={m.questionMode} hint={m.questionModes[settings.values.mode].hint}
          error={settings.saveError} value={settings.values.mode} options={QUESTION_MODES.map((value) => ({ value, label: m.questionModes[value].label }))}
          disabled={settings.saving} onValueChange={(mode) => void settings.save({ ...settings.values, mode }, settings.revision)} /></SettingsCard>}
    </SettingsSection>
  );
}

function SettingsRecovery({ colors, settings, resetLabel }: {
  colors: Colors;
  settings: { status: "error" | "invalid"; error: string; reload(): Promise<void>; reset(): Promise<boolean> };
  resetLabel?: string;
}) {
  const { messages: m } = useProgressLanguage();
  return <>
    <Text style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 19 }}>{settings.error}</Text>
    <SettingsCard>
      <SettingsAction label={m.tryAgain} actionLabel={m.reload} onPress={settings.reload} />
      {settings.status === "invalid" ? <SettingsAction label={resetLabel ?? m.resetTo(m.systemLanguage)} actionLabel={m.reset} onPress={settings.reset} /> : null}
    </SettingsCard>
  </>;
}
