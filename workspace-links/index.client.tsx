import type { PluginClientContext } from "@getpaseo/plugin/client";
import { LinksPanel } from "./client/panel";
import { contributeClient } from "./client/pills";

export default function contribute(client: PluginClientContext) {
  const stopPills = contributeClient(client);

  client.addWorkspacePanel({
    id: "links",
    title: "Links",
    icon: "Link2",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: LinksPanel,
  });
  client.addCommandCenterItem({
    id: "open-links",
    title: "Workspace Links",
    icon: "Link2",
    keywords: ["browser", "url"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("links", { location: "explorer" });
    },
  });

  return () => {
    stopPills();
  };
}
