import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useState } from "react";
import { Text } from "react-native";
import { IconSwap } from "./motion";
import { PressableRow } from "./row";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

export const PAGE = 10;

// Long newest-first lists show 10 at a time; each press loads 10 older. New
// items arrive at the top, so the latest stay in view.
export function usePaged<T>(items: T[]): { shown: T[]; older: number; showOlder(): void; showFewer(): void } {
  const [limit, setLimit] = useState(PAGE);
  return {
    shown: items.slice(0, limit),
    older: Math.max(0, items.length - limit),
    showOlder: () => setLimit(limit + PAGE),
    showFewer: () => setLimit(PAGE),
  };
}

// The row under a paged list: "Show 10 older", or "Show fewer" once all are shown.
export function ShowMoreRow({ colors, total, paged }: { colors: Colors; total: number; paged: ReturnType<typeof usePaged> }) {
  const more = paged.older > 0 ? { label: `Show ${Math.min(paged.older, PAGE)} older`, icon: "ChevronDown", onPress: paged.showOlder }
    : total > PAGE ? { label: "Show fewer", icon: "ChevronUp", onPress: paged.showFewer }
    : null;
  if (!more) return null;
  return (
    <PressableRow colors={colors} accessibilityRole="button" onPress={more.onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
      <IconSwap swapKey={more.icon} size={14}><Icon name={more.icon} size={14} color={colors.foregroundMuted} /></IconSwap>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{more.label}</Text>
    </PressableRow>
  );
}
