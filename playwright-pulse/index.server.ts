import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleGetPulse, handleOpenAttachment, handlePreviewAttachment, handleStopRun } from "./server/pulse";
import { handleInstallReporter } from "./server/reporter-install";
import { getPulse, installReporter, openAttachment, previewAttachment, stopRun } from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  server.handle(getPulse, handleGetPulse);
  server.handle(installReporter, handleInstallReporter);
  server.handle(previewAttachment, handlePreviewAttachment);
  server.handle(openAttachment, handleOpenAttachment);
  server.handle(stopRun, handleStopRun);
  return () => {};
}
