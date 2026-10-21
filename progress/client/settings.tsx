import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { DEFAULT_QUESTION_MODE, QUESTION_MODES } from "../shared/question-modes";
import { readSkill } from "../shared/rpc";
import { questionSettings, LANGUAGE_PREFERENCES } from "../shared/settings";
import { parseWriteUp, withoutTitle } from "../shared/write-up";
import { errorText } from "./errors";
import { useProgressLanguage } from "./language";
import { useSkill } from "./launcher";
import { BlockView } from "./write-up";

export function QuestionSettings({ theme, host }: PluginSurfaceProps) {
  return <><QuestionModeSettings theme={theme} /><DisplaySettings theme={theme} /><SkillSettings colors={theme.colors} hostId={host.id} /></>;
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

function SkillSettings({ colors, hostId }: { colors: Colors; hostId: string }) {
  const { messages: m } = useProgressLanguage();
  const skill = useSkill(hostId);
  const fetchSkill = useRpc(readSkill);
  const document = useQuery({ queryKey: ["progress", "skill-document", hostId], queryFn: () => fetchSkill({}), staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  const blocks = document.data ? withoutTitle(parseWriteUp(document.data.markdown)) : [];
  const muted = { color: colors.foregroundMuted, fontSize: 13, lineHeight: 19 };
  return (
    <SettingsSection title={m.agentSkill}>
      <SettingsCard>
        <SettingsAction label={m.skillName} hint={document.data?.description || undefined} actionLabel={m.viewSkill} onPress={() => setOpen(true)} />
        {skill.notice?.action ? (
          <SettingsAction label={skill.state === "outdated" ? m.skillLinkOutdated : m.skillNotInstalled} hint={skill.notice.text}
            actionLabel={skill.pending ? m.installing : skill.notice.action} disabled={skill.pending} onPress={skill.install} />
        ) : null}
      </SettingsCard>
      {/* Paseo draws the modal outside this tree, past the language context, so it only gets finished text. */}
      <Modal title={m.skillName} icon={<Icon name="Sparkles" size={16} color={colors.foregroundMuted} />} open={open} onOpenChange={setOpen}>
        <Modal.Content>
          {document.error ? <Text style={muted}>{m.readError(errorText(document.error, m.unknownError))}</Text>
            : !document.data ? <Text style={muted}>{m.loading}</Text>
            : <View style={{ gap: 8 }}>{blocks.map((block, index) => <BlockView key={index} colors={colors} block={block} first={index === 0} />)}</View>}
        </Modal.Content>
      </Modal>
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
