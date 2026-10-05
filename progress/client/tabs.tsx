import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

export interface TabEntry<Id extends string> {
  id: Id;
  label: string;
  icon?: string | null;
  // A count badge beside the label; none when undefined.
  count?: number;
}

// A row of tabs over a bottom rule, as in the panel's history card and the
// ticket dialog. Narrow tightens the spacing so three tabs fit the 320px sidebar.
// `fit` drops the icons when the tabs would otherwise wrap onto a second line.
export function TabStrip<Id extends string>({ colors, tabs, selected, onSelect, narrow = false, fit = false, style }: {
  colors: Colors;
  tabs: Array<TabEntry<Id>>;
  selected: Id;
  onSelect(id: Id): void;
  narrow?: boolean;
  fit?: boolean;
  style?: object;
}) {
  // Set once the tabs wrapped with icons, for this set of tabs.
  const ids = tabs.map((entry) => entry.id).join();
  const [wrappedFor, setWrappedFor] = useState<string | null>(null);
  const iconless = fit && wrappedFor === ids;
  return (
    <View accessibilityRole="tablist"
      // One row is 32px (8 + 18 + 6); anything taller wrapped.
      onLayout={fit ? (event) => { if (!iconless && event.nativeEvent.layout.height > 40) setWrappedFor(ids); } : undefined}
      style={[{ flexDirection: "row", flexWrap: "wrap", columnGap: narrow ? 10 : 16, borderBottomWidth: 1, borderBottomColor: colors.border }, style]}>
      {tabs.map((entry) => (
        <Tab key={entry.id} colors={colors} narrow={narrow} entry={iconless ? { ...entry, icon: null } : entry} selected={entry.id === selected} onPress={() => onSelect(entry.id)} />
      ))}
    </View>
  );
}

// Instant feedback: tabs switch often, so hover and press change color only.
function Tab<Id extends string>({ colors, narrow, entry, selected, onPress }: { colors: Colors; narrow: boolean; entry: TabEntry<Id>; selected: boolean; onPress(): void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: narrow ? 4 : 6, paddingTop: 8, paddingBottom: 6, marginBottom: -1,
        borderBottomWidth: 2,
        borderBottomColor: selected ? colors.accent : pressed || hovered ? colors.border : "transparent",
      })}>
      {entry.icon ? <Icon name={entry.icon} size={14} color={selected ? colors.accent : colors.foregroundMuted} /> : null}
      <Text style={{ color: selected || hovered ? colors.foreground : colors.foregroundMuted, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{entry.label}</Text>
      {/* Count badge: muted on both tabs; the chosen tab's number reads darker. */}
      {entry.count !== undefined ? (
        <View style={{ minWidth: 16, paddingHorizontal: 4, borderRadius: 4, alignItems: "center", backgroundColor: colors.surface2 }}>
          <Text style={{ color: selected ? colors.foreground : colors.foregroundMuted, fontSize: 10, lineHeight: 14, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{entry.count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
