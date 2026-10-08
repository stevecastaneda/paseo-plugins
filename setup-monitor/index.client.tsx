import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeClient } from "./client/buttons";

export default function contribute(client: PluginClientContext) {
  return contributeClient(client);
}
