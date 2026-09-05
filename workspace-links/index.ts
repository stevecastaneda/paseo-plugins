import type { PluginContext } from "@getpaseo/plugin";
import { LinksPanel } from "./panel.client";
import { getLinks, openLink } from "./links.shared";
import { handleGetLinks, handleOpenLink } from "./links.server";

import { contributeClient } from "./pills.client";

export default function contribute(plugin: PluginContext) {
  plugin.handle(getLinks, handleGetLinks);
  plugin.addClientSide(contributeClient);
  plugin.handle(openLink, handleOpenLink);
  plugin.addWorkspacePanel({
    id: "links", title: "Links", icon: "ExternalLink", context: "workspace",
    locations: ["workspace", "explorer"], Component: LinksPanel,
  });
  plugin.addCommandCenterItem({
    id: "open-links", title: "Workspace Links", icon: "ExternalLink",
    keywords: ["browser", "url"], context: "workspace",
    onSelect({ openPanel }) { openPanel("links", { location: "explorer" }); },
  });
  return () => {};
}
