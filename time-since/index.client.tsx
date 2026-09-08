import type { PluginClientContext } from "@getpaseo/plugin/client";
import { TimeSinceOptionsPanel } from "./client/settings-panel";
import { contributeClient } from "./client/ticker";

export default function contribute(client: PluginClientContext) {
  const stopTicker = contributeClient(client);

  client.addWorkspacePanel({
    id: "options",
    title: "Time Since Options",
    icon: "Clock",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: TimeSinceOptionsPanel,
  });
  client.addCommandCenterItem({
    id: "open-options",
    title: "Time Since Options",
    icon: "Clock",
    keywords: ["clock", "elapsed", "ago", "settings"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("options", { location: "explorer" });
    },
  });

  return () => {
    stopTicker();
  };
}
