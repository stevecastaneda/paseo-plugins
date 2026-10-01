import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleGetAttention, handleGetDashboard, handleListFolders, handleMarkPanelOpened, handleSetHistoryFolder } from "./server/dashboard";
import { handleInstallLauncher, handleLauncherStatus } from "./server/launcher";
import { handleOpenDeliverable, handlePreviewDeliverable } from "./server/open";
import { handleInstallSkill, handleSkillStatus } from "./server/skill";
import { getAttention, getDashboard, getLauncherStatus, getSkillStatus, installLauncher, installSkill, listFolders, markPanelOpened, openDeliverable, previewDeliverable, setHistoryFolder } from "./shared/rpc";

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
  server.handle(listFolders, handleListFolders);
  server.handle(setHistoryFolder, handleSetHistoryFolder);
  return () => {};
}
