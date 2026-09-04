import type { PluginContext } from "@getpaseo/plugin";
import { contributeClient } from "./ticker.client";

export default function contribute(plugin: PluginContext) {
  plugin.addClientSide(contributeClient);
  return () => {};
}
