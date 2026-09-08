import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { settingsStore } from "./settings.storage.ts";
import type { TimeSinceSettings } from "../shared/settings.ts";

export function handleGetSettings(
  _input: Record<string, never>,
  _context: PluginHandlerContext,
): Promise<TimeSinceSettings> {
  return settingsStore.get();
}

export function handleUpdateSettings(
  input: Partial<TimeSinceSettings>,
  _context: PluginHandlerContext,
): Promise<TimeSinceSettings> {
  return settingsStore.update(input);
}
