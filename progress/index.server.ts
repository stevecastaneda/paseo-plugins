import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleGetAttention, handleGetDashboard, handleListFolders, handleMarkPanelOpened, handleSetHistoryFolder } from "./server/dashboard";
import { handleInstallLauncher, handleLauncherStatus } from "./server/launcher";
import { handleCanOpenOnHost, handleOpenDeliverable, handlePreviewDeliverable, handleReadDeliverablePiece } from "./server/open";
import { mirrorQuestionMode } from "./server/question-mode";
import { handleInstallSkill, handleSkillStatus, repairSkill } from "./server/skill";
import { handleDismissWhatsNew, handleGetWhatsNew } from "./server/whats-new";
import { canOpenOnHost, dismissWhatsNew, getAttention, getDashboard, getLauncherStatus, getSkillStatus, getWhatsNew, installLauncher, installSkill, listFolders, markPanelOpened, openDeliverable, previewDeliverable, readDeliverablePiece, setHistoryFolder } from "./shared/rpc";
import { displaySettings, questionSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  server.handle(getDashboard, handleGetDashboard);
  server.handle(getAttention, handleGetAttention);
  server.handle(markPanelOpened, handleMarkPanelOpened);
  server.handle(getLauncherStatus, handleLauncherStatus);
  server.handle(installLauncher, handleInstallLauncher);
  server.handle(openDeliverable, handleOpenDeliverable);
  server.handle(canOpenOnHost, handleCanOpenOnHost);
  server.handle(previewDeliverable, handlePreviewDeliverable);
  server.handle(readDeliverablePiece, handleReadDeliverablePiece);
  server.handle(getSkillStatus, handleSkillStatus);
  server.handle(installSkill, handleInstallSkill);
  server.handle(listFolders, handleListFolders);
  server.handle(setHistoryFolder, handleSetHistoryFolder);
  server.handle(getWhatsNew, handleGetWhatsNew);
  server.handle(dismissWhatsNew, handleDismissWhatsNew);
  // Settles a new install before any panel opens. Opening one makes a
  // worktree folder, which would look like an earlier version's.
  void handleGetWhatsNew().catch(() => {});
  void repairSkill();
  server.registerSettings(displaySettings);
  const mirror = mirrorQuestionMode(server.registerSettings(questionSettings));
  return mirror.stop;
}
