import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleCheckSetupFolder, handleGetAttention, handleGetDashboard, handleListSetupFolders, handleMarkPanelOpened, handleSaveSetup } from "./server/dashboard";
import { handleInstallLauncher, handleLauncherStatus } from "./server/launcher";
import { handleOpenDeliverable, handlePreviewDeliverable } from "./server/open";
import { handleInstallSkill, handleSkillStatus } from "./server/skill";
import { checkSetupFolder, getAttention, getDashboard, getLauncherStatus, getSkillStatus, installLauncher, listSetupFolders, installSkill, markPanelOpened, openDeliverable, previewDeliverable, saveSetup } from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  server.handle(getDashboard, handleGetDashboard);
  server.handle(getAttention, handleGetAttention);
  server.handle(markPanelOpened, handleMarkPanelOpened);
  server.handle(getLauncherStatus, handleLauncherStatus);
  server.handle(installLauncher, handleInstallLauncher);
  server.handle(openDeliverable, handleOpenDeliverable);
  server.handle(previewDeliverable, handlePreviewDeliverable);
  server.handle(getSkillStatus, handleSkillStatus);
  server.handle(installSkill, handleInstallSkill);
  server.handle(checkSetupFolder, handleCheckSetupFolder);
  server.handle(listSetupFolders, handleListSetupFolders);
  server.handle(saveSetup, handleSaveSetup);
  return () => {};
}
