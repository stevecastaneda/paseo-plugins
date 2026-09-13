import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readHistory } from "./shared/history";
import { handleReadHistory } from "./server/history";

export default function contribute(server: PluginServerContext) {
  server.handle(readHistory, handleReadHistory);
  return () => {};
}
