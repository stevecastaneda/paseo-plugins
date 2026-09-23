import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleGetSettings, handleUpdateSettings } from "./server/settings";
import { getSettings, updateSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  server.handle(getSettings, handleGetSettings);
  server.handle(updateSettings, handleUpdateSettings);
  return () => {};
}
