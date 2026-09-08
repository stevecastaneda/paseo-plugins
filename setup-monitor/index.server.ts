import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleGetSetupStatus, stopSetupProgressWatch } from "./server/daemon";
import { getSetupStatus } from "./shared/setup";

export default function contribute(server: PluginServerContext) {
  server.handle(getSetupStatus, handleGetSetupStatus);
  return () => {
    stopSetupProgressWatch();
  };
}
