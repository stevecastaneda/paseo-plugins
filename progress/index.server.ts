import type { PluginServerContext } from "@getpaseo/plugin/server";
import { AnswerQueue, RETRY_MS, whenWorkingFrom } from "./server/answers";
import { handleGetAttention, handleGetDashboard, handleListFolders, handleMarkPanelOpened, handleSetHistoryFolder } from "./server/dashboard";
import { handleInstallLauncher, handleLauncherStatus } from "./server/launcher";
import { handleCanOpenOnHost, handleOpenDeliverable, handlePreviewDeliverable, handleReadDeliverablePiece } from "./server/open";
import { mirrorQuestionMode } from "./server/question-mode";
import { handleInstallSkill, handleReadSkill, handleSkillStatus, repairSkill } from "./server/skill";
import { attachProgressTools, handleToolsStatus } from "./server/tool";
import { handleDismissWhatsNew, handleGetWhatsNew } from "./server/whats-new";
import {
  cancelAnswer,
  canOpenOnHost,
  dismissWhatsNew,
  getAttention,
  getDashboard,
  getLauncherStatus,
  getSkillStatus,
  getToolsStatus,
  getWhatsNew,
  installLauncher,
  installSkill,
  listFolders,
  readSkill,
  markPanelOpened,
  openDeliverable,
  previewDeliverable,
  readDeliverablePiece,
  sendAnswer,
  setHistoryFolder,
} from "./shared/rpc";
import { answerSettings, displaySettings, questionSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  const answers = new AnswerQueue(whenWorkingFrom(server.registerSettings(answerSettings)));
  server.handle(getDashboard, (input, context) => handleGetDashboard(input, context, answers));
  server.handle(sendAnswer, async ({ answer, now, ...target }, { paseo }) => {
    answers.capture(paseo);
    return { result: await answers.send(target, answer, now) };
  });
  server.handle(cancelAnswer, async (target) => {
    await answers.cancel(target);
    return {};
  });
  server.addHook("agent.turn.after", async ({ agent, outcome }, { paseo }) => {
    answers.capture(paseo);
    await answers.turnEnded(agent.id, outcome.kind);
  });
  server.addHook("agent.archive.after", ({ agent }) => answers.agentGone(agent.id));
  const retry = setInterval(() => void answers.retry().catch(() => {}), RETRY_MS);
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
  server.handle(readSkill, handleReadSkill);
  server.handle(listFolders, handleListFolders);
  server.handle(setHistoryFolder, handleSetHistoryFolder);
  server.handle(getToolsStatus, handleToolsStatus);
  server.handle(getWhatsNew, handleGetWhatsNew);
  server.handle(dismissWhatsNew, handleDismissWhatsNew);
  // Settles a new install before any panel opens. Opening one makes a
  // worktree folder, which would look like an earlier version's.
  void handleGetWhatsNew().catch(() => {});
  void repairSkill();
  attachProgressTools(server);
  server.registerSettings(displaySettings);
  const mirror = mirrorQuestionMode(server.registerSettings(questionSettings));
  return () => {
    clearInterval(retry);
    return mirror.stop();
  };
}
