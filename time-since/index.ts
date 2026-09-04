import type { PluginContext } from "@getpaseo/plugin";
import { handleGetLastThreadMessage } from "./last-message.server";
import { getLastThreadMessage } from "./last-message.shared";
import { contributeClient } from "./ticker.client";

export default function contribute(plugin: PluginContext) {
  plugin.handle(getLastThreadMessage, handleGetLastThreadMessage);
  plugin.addClientSide(contributeClient);
  return () => {};
}
