import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import React from "react";
import { Text } from "react-native";
import { formatAgo, formatClock } from "../shared/format";
import { useNarrow } from "./narrow";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// "Sep 27, 8:14 PM (10 h 2 min ago)", inline inside other text. A narrow
// panel shows only "10 h 2 min ago"; the ticket dialog keeps the clock time.
export function When({ colors, iso, now }: { colors: Colors; iso: string; now: number }) {
  if (useNarrow()) return <Text>{formatAgo(iso, now)}</Text>;
  return (
    <Text>
      {formatClock(iso)} <Text style={{ color: colors.foregroundMuted, opacity: 0.7 }}>({formatAgo(iso, now)})</Text>
    </Text>
  );
}
