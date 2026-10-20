import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleGetAttention, handleGetDashboard, handleListFolders, handleMarkPanelOpened, handleSetHistoryFolder } from "./server/dashboard";
import { handleInstallLauncher, handleLauncherStatus } from "./server/launcher";
import { handleCanOpenOnHost, handleOpenDeliverable, handlePreviewDeliverable, handleReadDeliverablePiece } from "./server/open";
import { mirrorQuestionMode } from "./server/question-mode";
import { handleInstallSkill, handleSkillStatus } from "./server/skill";
import { canOpenOnHost, getAttention, getDashboard, getLauncherStatus, getSkillStatus, installLauncher, installSkill, listFolders, markPanelOpened, openDeliverable, previewDeliverable, readDeliverablePiece, setHistoryFolder } from "./shared/rpc";
import { questionSettings } from "./shared/settings";

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
  const mirror = mirrorQuestionMode(server.registerSettings(questionSettings));
  return () => mirror.stop();
}
