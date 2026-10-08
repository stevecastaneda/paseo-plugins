import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleGetLinks } from "./server/links";
import { handleGetLinkStatus } from "./server/status";
import { handleGetShortcutSettings, handleUpdateShortcutSettings } from "./server/shortcut";
import { getLinks, getLinkStatus } from "./shared/links";
import { getShortcutSettings, updateShortcutSettings } from "./shared/shortcut";

export default function contribute(server: PluginServerContext) {
  server.handle(getLinks, handleGetLinks);
  server.handle(getLinkStatus, handleGetLinkStatus);
  server.handle(getShortcutSettings, handleGetShortcutSettings);
  server.handle(updateShortcutSettings, handleUpdateShortcutSettings);
  return () => {};
}
