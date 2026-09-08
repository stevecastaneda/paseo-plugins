import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SetupPanel } from "./client/panel";
import { contributeClient } from "./client/pills";

export default function contribute(client: PluginClientContext) {
  const stopPills = contributeClient(client);

  client.addWorkspacePanel({
    id: "setup",
    title: "Setup",
    icon: "Package",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: SetupPanel,
  });
  client.addCommandCenterItem({
    id: "open-setup",
    title: "Open Setup",
    icon: "Package",
    keywords: ["install", "npm", "worktree", "setup"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("setup", { location: "explorer" });
    },
  });

  return () => {
    stopPills();
  };
}
