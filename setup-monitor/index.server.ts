import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleGetSetupStatus, handleRunSetup, stopSetupProgressWatch } from "./server/daemon";
import { getSetupStatus, runSetup } from "./shared/setup";

export default function contribute(server: PluginServerContext) {
  server.handle(getSetupStatus, handleGetSetupStatus);
  server.handle(runSetup, handleRunSetup);
  return () => {
    stopSetupProgressWatch();
  };
}
