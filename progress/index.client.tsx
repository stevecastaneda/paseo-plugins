import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ProgressPanel } from "./client/panel";
import { contributePills, progressPanel } from "./client/pills";
import { QuestionSettings } from "./client/settings";

const SETTINGS_ID = "settings";

export default function contribute(client: PluginClientContext) {
  const stopPills = contributePills(client);
  const panel = progressPanel();
  const stopPanel = client.addWorkspacePanel({
    id: panel.id,
    title: "Progress",
    icon: "ListChecks",
    context: "workspace",
    locations: [panel.location],
    Component: (props) => <ProgressPanel {...props} openSettings={() => client.openSettings(SETTINGS_ID)} />,
  });
  const stopCommand = client.addCommandCenterItem({
    id: "open-progress",
    title: "Open Progress",
    icon: "ListChecks",
    keywords: ["dashboard", "tickets", "status", "questions"],
    context: "workspace",
    // Beside the agent chat where Paseo can show both; a tab of its own on phones.
    onSelect({ openPanel }) {
      openPanel(panel.id, { location: panel.location });
    },
  });

  const stopSettings = client.addSettingsScreen({
    id: SETTINGS_ID,
    title: "Settings",
    icon: "Settings",
    Component: QuestionSettings,
  });

  return () => {
    void stopSettings();
    void stopPanel();
    void stopCommand();
    stopPills();
  };
}
