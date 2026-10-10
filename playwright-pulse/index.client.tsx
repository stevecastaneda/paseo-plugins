import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { OptionsPanel } from "./client/options-panel";
import { PulsePanel } from "./client/panel";
import { watchRuns } from "./client/pill";
import { createSidebarItem } from "./client/sidebar";

const PANEL_ID = "playwright-pulse";
const OPTIONS_ID = "options";
// Beside the agent chat where Paseo can show both; a tab of its own on phones.
const LOCATION = Platform.OS === "web" ? "explorer" : "workspace";

export default function contribute(client: PluginClientContext) {
  const stopPanel = client.addWorkspacePanel({
    id: PANEL_ID,
    title: "Playwright Pulse",
    icon: "Activity",
    context: "workspace",
    locations: [LOCATION],
    Component: PulsePanel,
  });
  const stopCommand = client.addCommandCenterItem({
    id: "open-playwright-pulse",
    title: "Open Playwright Pulse",
    icon: "Activity",
    keywords: ["playwright", "e2e", "tests", "test run"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(PANEL_ID, { location: LOCATION });
    },
  });
  const stopOptionsPanel = client.addWorkspacePanel({
    id: OPTIONS_ID,
    title: "Playwright Pulse Options",
    icon: "Settings",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: OptionsPanel,
  });
  const stopOptionsCommand = client.addCommandCenterItem({
    id: "open-options",
    title: "Playwright Pulse Options",
    icon: "Settings",
    keywords: ["playwright", "pulse", "settings", "options", "sidebar"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(OPTIONS_ID, { location: "explorer" });
    },
  });

  const openPulse = (workspaceId: string) => client.openPanel(PANEL_ID, { workspaceId, location: LOCATION });
  // The sidebar's list of runs is there only while the option is on.
  let removeSidebar: (() => void) | null = null;
  const watcher = watchRuns(client, openPulse, (settings) => {
    if (settings.sidebar && !removeSidebar) {
      const remove = client.addSidebarHeaderItem({ id: "test-runs", title: "Playwright test runs", Component: createSidebarItem(watcher.store, openPulse) });
      removeSidebar = () => void remove();
    } else if (!settings.sidebar && removeSidebar) {
      removeSidebar();
      removeSidebar = null;
    }
  });

  return () => {
    watcher.stop();
    removeSidebar?.();
    void stopPanel();
    void stopCommand();
    void stopOptionsPanel();
    void stopOptionsCommand();
  };
}
