import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { ShortcutSettings } from "../shared/shortcut.ts";
import { settingsStore } from "./shortcut.storage.ts";

export function handleGetShortcutSettings(
  _input: Record<string, never>,
  _context: PluginHandlerContext,
): Promise<ShortcutSettings> {
  return settingsStore.get();
}

export function handleUpdateShortcutSettings(
  input: Partial<ShortcutSettings>,
  _context: PluginHandlerContext,
): Promise<ShortcutSettings> {
  return settingsStore.update(input);
}
