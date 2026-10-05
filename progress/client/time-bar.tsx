import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import React from "react";
import { View } from "react-native";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// Time worked filling the estimate. Past the estimate the bar is full and the
// share over it turns red.
export function TimeBar({ colors, workedMin, estimateMin }: { colors: Colors; workedMin: number; estimateMin: number }) {
  const scale = Math.max(workedMin, estimateMin);
  const under = Math.min(workedMin, estimateMin);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ height: 4, borderRadius: 2, overflow: "hidden", flexDirection: "row", backgroundColor: colors.surface2 }}>
      <View style={{ width: `${(under / scale) * 100}%`, backgroundColor: colors.accent }} />
      {workedMin > estimateMin ? <View style={{ width: `${((workedMin - estimateMin) / scale) * 100}%`, backgroundColor: colors.statusDanger }} /> : null}
    </View>
  );
}
