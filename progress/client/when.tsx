import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import React from "react";
import { Text } from "react-native";
import { formatAgo, formatClock } from "../shared/format";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// "Sep 27, 8:14 PM (10 h 2 min ago)", inline inside other text.
export function When({ colors, iso, now }: { colors: Colors; iso: string; now: number }) {
  return (
    <Text>
      {formatClock(iso)} <Text style={{ color: colors.foregroundMuted, opacity: 0.7 }}>({formatAgo(iso, now)})</Text>
    </Text>
  );
}
