import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleGetLinks, handleOpenLink } from "./server/links";
import { handleGetShortcutSettings, handleUpdateShortcutSettings } from "./server/shortcut";
import { getLinks, openLink } from "./shared/links";
import { getShortcutSettings, updateShortcutSettings } from "./shared/shortcut";

export default function contribute(server: PluginServerContext) {
  server.handle(getLinks, handleGetLinks);
  server.handle(openLink, handleOpenLink);
  server.handle(getShortcutSettings, handleGetShortcutSettings);
  server.handle(updateShortcutSettings, handleUpdateShortcutSettings);
  return () => {};
}
