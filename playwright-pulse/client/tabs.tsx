// A card of tabs, copied from the Progress plugin's history card so the two
// panels look and behave alike.
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useNarrow } from "./narrow";
import { raised } from "./surfaces";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

export type TabEntry = { id: string; label: string; icon: string; count: number; empty: string; content: React.ReactNode };

// Below this width the tab icons drop, so every label fits in the Explorer pane.
const TAB_ICONS_MIN = 370;

// The tab chosen per key (a workspace), kept for the app session so reopening
// the panel shows the same one.
const chosenTabs = new Map<string, string>();

export function TabbedCard({ colors, memoryKey, tabs }: { colors: Colors; memoryKey: string; tabs: TabEntry[] }) {
  const [tab, setTab] = useState(() => chosenTabs.get(memoryKey) ?? tabs[0]?.id);
  const [showIcons, setShowIcons] = useState(true);
  const narrow = useNarrow();
  const choose = (next: string) => {
    chosenTabs.set(memoryKey, next);
    setTab(next);
  };
  const current = tabs.find((entry) => entry.id === tab) ?? tabs[0];
  return (
    <View onLayout={(event) => setShowIcons(event.nativeEvent.layout.width >= TAB_ICONS_MIN)}
      style={{ margin: 12, marginBottom: 0, ...raised(colors), borderRadius: 6, overflow: "hidden" }}>
      <View accessibilityRole="tablist" style={{ flexDirection: "row", flexWrap: "wrap", columnGap: narrow ? 10 : 16, paddingHorizontal: narrow ? 8 : 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {tabs.map((entry) => (
          <Tab key={entry.id} colors={colors} narrow={narrow} label={entry.label} icon={showIcons ? entry.icon : null} count={entry.count}
            selected={entry.id === current.id} onPress={() => choose(entry.id)} />
        ))}
      </View>
      {current.count === 0 ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, paddingHorizontal: 10, paddingVertical: 8 }}>{current.empty}</Text>
      ) : current.content}
    </View>
  );
}

// Instant feedback: tabs switch often, so hover and press change color only.
// Narrow tightens the spacing so every tab stays on one line at the sidebar's 320px.
function Tab({ colors, narrow, label, icon, count, selected, onPress }: { colors: Colors; narrow: boolean; label: string; icon: string | null; count: number; selected: boolean; onPress(): void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: narrow ? 4 : 5, paddingTop: 8, paddingBottom: 6, marginBottom: -1,
        borderBottomWidth: 2,
        borderBottomColor: selected ? colors.accent : pressed || hovered ? colors.border : "transparent",
      })}>
      {/* 12px: a Lucide glyph fills its box, so this matches the label's capitals; 14px towers over them. */}
      {icon ? <Icon name={icon} size={12} color={selected ? colors.accent : colors.foregroundMuted} /> : null}
      <Text style={{ color: selected || hovered ? colors.foreground : colors.foregroundMuted, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{label}</Text>
      {/* Count badge: muted on every tab; the chosen tab's number reads darker. */}
      <View style={{ minWidth: 16, paddingHorizontal: 4, borderRadius: 4, alignItems: "center", backgroundColor: colors.surface2 }}>
        <Text style={{ color: selected ? colors.foreground : colors.foregroundMuted, fontSize: 10, lineHeight: 14, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{count}</Text>
      </View>
    </Pressable>
  );
}
