import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ProgressPanel } from "./client/panel";
import { contributePills } from "./client/pills";

export default function contribute(client: PluginClientContext) {
  const stopPills = contributePills(client);
  const stopPanel = client.addWorkspacePanel({
    id: "progress",
    title: "Progress",
    icon: "ListChecks",
    context: "workspace",
    locations: ["explorer"],
    Component: ProgressPanel,
  });
  const stopCommand = client.addCommandCenterItem({
    id: "open-progress",
    title: "Open Progress",
    icon: "ListChecks",
    keywords: ["dashboard", "tickets", "status", "questions"],
    context: "workspace",
    // Explorer only: the dashboard sits beside the agent chat, so both stay in view.
    onSelect({ openPanel }) {
      openPanel("progress", { location: "explorer" });
    },
  });

  return () => {
    void stopPanel();
    void stopCommand();
    stopPills();
  };
}
