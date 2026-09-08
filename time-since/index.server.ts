import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleGetLastThreadMessage } from "./server/last-message";
import { handleGetSettings, handleUpdateSettings } from "./server/settings";
import { getLastThreadMessage } from "./shared/last-message";
import { getSettings, updateSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  server.handle(getLastThreadMessage, handleGetLastThreadMessage);
  server.handle(getSettings, handleGetSettings);
  server.handle(updateSettings, handleUpdateSettings);
  return () => {};
}
