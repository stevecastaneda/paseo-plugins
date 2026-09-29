import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import React from "react";
import { Text, View } from "react-native";
import type { TicketStatus } from "../shared/events";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

export const STATUS_LABEL: Record<TicketStatus, string> = {
  not_started: "Not started",
  working: "Working",
  blocked: "Blocked",
  done: "Done",
  skipped: "Skipped",
};

// `waiting`: held for another ticket. Shown as calm as "Not started", whatever the status.
export function StatusBadge({ colors, status, waiting = false }: { colors: Colors; status: TicketStatus; waiting?: boolean }) {
  const tone = waiting ? { fg: colors.foregroundMuted, bg: "transparent", border: colors.border } : {
    done: { fg: colors.statusSuccess, bg: "transparent", border: colors.statusSuccess },
    working: { fg: colors.accentForeground, bg: colors.accent, border: colors.accent },
    blocked: { fg: colors.statusDanger, bg: "transparent", border: colors.statusDanger },
    skipped: { fg: colors.foregroundMuted, bg: "transparent", border: colors.border },
    not_started: { fg: colors.foregroundMuted, bg: "transparent", border: colors.border },
  }[status];
  return (
    <View style={{ borderWidth: 1, borderColor: tone.border, backgroundColor: tone.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 }}>
      <Text style={{ color: tone.fg, fontSize: 11, lineHeight: 16 }}>{waiting ? "Waiting" : STATUS_LABEL[status]}</Text>
    </View>
  );
}
