import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleGetLinks, handleOpenLink } from "./server/links";
import { getLinks, openLink } from "./shared/links";

export default function contribute(server: PluginServerContext) {
  server.handle(getLinks, handleGetLinks);
  server.handle(openLink, handleOpenLink);
  return () => {};
}
