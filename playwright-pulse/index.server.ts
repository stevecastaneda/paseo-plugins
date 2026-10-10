import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleGetBriefs, handleGetPulse, handleOpenAttachment, handlePreviewAttachment, handleStopRun } from "./server/pulse";
import { handleInstallReporter, startReporter, stopReporter } from "./server/reporter-install";
import { pruneRuns } from "./server/run-file";
import { createSettingsStore } from "./server/settings";
import { getSettings, updateSettings } from "./shared/settings";
import { getBriefs, getPulse, installReporter, openAttachment, previewAttachment, stopRun } from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  server.handle(getPulse, handleGetPulse);
  server.handle(getBriefs, (input) => handleGetBriefs(input));
  const settings = createSettingsStore();
  server.handle(getSettings, () => settings.get());
  server.handle(updateSettings, (patch) => settings.update(patch));
  server.handle(installReporter, handleInstallReporter);
  server.handle(previewAttachment, handlePreviewAttachment);
  server.handle(openAttachment, handleOpenAttachment);
  server.handle(stopRun, handleStopRun);
  // The reporter file exists only while the plugin runs (see reporter-install.ts).
  void startReporter();
  void pruneRuns();
  return () => stopReporter();
}
