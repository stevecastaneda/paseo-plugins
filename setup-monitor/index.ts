import type { PluginContext } from "@getpaseo/plugin";
import { handleGetSetupStatus, stopSetupProgressWatch } from "./daemon.server";
import { SetupPanel } from "./panel.client";
import { contributeClient } from "./pills.client";
import { getSetupStatus } from "./setup.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(getSetupStatus, handleGetSetupStatus);
  plugin.addClientSide(contributeClient);
  plugin.addWorkspacePanel({
    id: "setup",
    title: "Setup",
    icon: "Package",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: SetupPanel,
  });
  plugin.addCommandCenterItem({
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
    stopSetupProgressWatch();
  };
}
