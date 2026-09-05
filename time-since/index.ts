import type { PluginContext } from "@getpaseo/plugin";
import { handleGetLastThreadMessage } from "./last-message.server";
import { getLastThreadMessage } from "./last-message.shared";
import { contributeClient } from "./ticker.client";
import { TimeSinceOptionsPanel } from "./settings-panel.client";
import { handleGetSettings, handleUpdateSettings } from "./settings.server";
import { getSettings, updateSettings } from "./settings.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(getLastThreadMessage, handleGetLastThreadMessage);
  plugin.addClientSide(contributeClient);
  plugin.handle(getSettings, handleGetSettings);
  plugin.handle(updateSettings, handleUpdateSettings);
  plugin.addWorkspacePanel({
    id: "options",
    title: "Time Since Options",
    icon: "Clock",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: TimeSinceOptionsPanel,
  });
  plugin.addCommandCenterItem({
    id: "open-options",
    title: "Time Since Options",
    icon: "Clock",
    keywords: ["clock", "elapsed", "ago", "settings"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("options", { location: "explorer" });
    },
  });
  return () => {};
}
