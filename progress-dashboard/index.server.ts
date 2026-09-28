import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleGetDashboard } from "./server/dashboard";
import { handleInstallLauncher, handleLauncherStatus } from "./server/launcher";
import { handleOpenDeliverable } from "./server/open";
import { handleInstallSkill, handleSkillStatus } from "./server/skill";
import { getDashboard, getLauncherStatus, getSkillStatus, installLauncher, installSkill, openDeliverable } from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  server.handle(getDashboard, handleGetDashboard);
  server.handle(getLauncherStatus, handleLauncherStatus);
  server.handle(installLauncher, handleInstallLauncher);
  server.handle(openDeliverable, handleOpenDeliverable);
  server.handle(getSkillStatus, handleSkillStatus);
  server.handle(installSkill, handleInstallSkill);
  return () => {};
}
