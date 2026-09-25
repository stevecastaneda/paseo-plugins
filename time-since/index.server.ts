import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listLastRepliesHandler, recordLastReplies } from "./server/last-reply";
import { handleGetSettings, handleUpdateSettings } from "./server/settings";
import { listLastReplies } from "./shared/last-reply";
import { getSettings, updateSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  const stopRecording = recordLastReplies(server);
  server.handle(listLastReplies, listLastRepliesHandler());
  server.handle(getSettings, handleGetSettings);
  server.handle(updateSettings, handleUpdateSettings);
  return stopRecording;
}
