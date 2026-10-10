import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { PulsePanel } from "./client/panel";
import { watchRuns } from "./client/pill";

const PANEL_ID = "playwright-pulse";
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
  const stopPills = watchRuns(client, (workspaceId) => client.openPanel(PANEL_ID, { workspaceId, location: LOCATION }));
  return () => {
    stopPills();
    void stopPanel();
    void stopCommand();
  };
}
