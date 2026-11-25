import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleGetSetupStatus, handleRunSetup, handleWorkspaceCreated, stopSetupProgressWatch } from "./server/daemon";
import { getSetupStatus, runSetup } from "./shared/setup";

export default function contribute(server: PluginServerContext) {
  server.handle(getSetupStatus, handleGetSetupStatus);
  server.handle(runSetup, handleRunSetup);
  server.addHook("workspace.create.after", handleWorkspaceCreated);
  return () => {
    stopSetupProgressWatch();
  };
}
