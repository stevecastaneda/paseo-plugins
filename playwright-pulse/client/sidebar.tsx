// The workspaces with a test run going (or just ended), at the top of Paseo's
// sidebar, so a run is in sight from any workspace. Each row opens that
// workspace's Pulse panel. It renders nothing while no run is worth showing.
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import type { PillTone } from "../shared/view";
import type { RunStore, WorkspaceRun } from "./pill";
import { IconSwap } from "./motion";
import { LucideSpinner } from "./spinner";

type Colors = PluginSidebarItemProps["theme"]["colors"];

// Paseo's own sidebar rows (SidebarHeaderRow, compact) measure these; the kit's
// SidebarRow lets long names wrap, so the row is drawn here to keep one line.
const ICON = 14;
const ROW_HEIGHT = 28;
const INSET = 8;

function RunIcon({ tone, colors }: { tone: PillTone; colors: Colors }) {
  switch (tone) {
    case "running": return <LucideSpinner color={colors.accent} size={ICON} />;
    case "failing": return <LucideSpinner color={colors.statusDanger} size={ICON} />;
    case "passed": return <Icon name="CircleCheck" size={ICON} color={colors.statusSuccess} />;
    case "failed": return <Icon name="CircleX" size={ICON} color={colors.statusDanger} />;
    case "stopped": return <Icon name="CircleStop" size={ICON} color={colors.statusWarning} />;
  }
}

// Words for screen readers, which can't see the icon.
const TONE_WORDS: Record<PillTone, string> = { running: "running", failing: "running", passed: "passed", failed: "failed", stopped: "stopped" };

function spoken({ name, view }: WorkspaceRun): string {
  const parts = [`${name}, tests ${TONE_WORDS[view.tone]}`];
  if (view.progress) parts.push(`${view.progress.replace("/", " of ")} done`);
  if (view.failed) parts.push(`${view.failed} failed`);
  return parts.join(", ");
}

const NUMBERS = { fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums" as const] };

function RunRow({ run, colors, onPress }: { run: WorkspaceRun; colors: Colors; onPress(): void }) {
  const [hovered, setHovered] = useState(false);
  const { name, view } = run;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={spoken(run)} onPress={onPress}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      style={{
        flexDirection: "row", alignItems: "center", gap: INSET, minHeight: ROW_HEIGHT,
        paddingHorizontal: INSET, paddingVertical: 4, borderRadius: 8,
        // Paseo's sidebar hover is its surface1.
        backgroundColor: hovered ? colors.surface1 : "transparent",
      }}>
      {/* The icon carries the state; it cross-fades when that changes, and a
          spinner keeps turning while only the numbers do. */}
      <IconSwap swapKey={view.tone} size={ICON}><RunIcon tone={view.tone} colors={colors} /></IconSwap>
      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: hovered ? colors.foreground : colors.foregroundMuted, fontSize: 14, lineHeight: 20 }}>
        {name}
      </Text>
      {/* Only numbers on the right: failures (a cross and a count), then progress. */}
      {view.failed || view.progress ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {view.failed ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
              <Icon name="X" size={12} color={colors.statusDanger} />
              <Text style={{ ...NUMBERS, color: colors.statusDanger }}>{view.failed}</Text>
            </View>
          ) : null}
          {view.progress ? <Text style={{ ...NUMBERS, color: colors.foregroundMuted }}>{view.progress}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export function createSidebarItem(store: RunStore, openPanel: (workspaceId: string) => void) {
  return function TestRuns({ theme, layout }: PluginSidebarItemProps) {
    const runs = useSyncExternalStore(store.subscribe, store.get);
    // On phones the sidebar covers the screen, and Paseo closes it only for its
    // own screens: a row would open the panel behind it. The header pill
    // shows the run there instead.
    if (layout.compact || !runs.length) return null;
    return (
      <View style={{ paddingHorizontal: INSET }}>
        {runs.map((run) => <RunRow key={run.workspaceId} run={run} colors={theme.colors} onPress={() => openPanel(run.workspaceId)} />)}
      </View>
    );
  };
}
