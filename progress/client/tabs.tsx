import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import React, { useRef, useState } from "react";
import { type LayoutChangeEvent, Pressable, ScrollView, Text, View } from "react-native";
import { useReducedMotion } from "./motion";
import { withAlpha } from "./surfaces";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

export interface TabEntry<Id extends string> {
  id: Id;
  label: string;
  icon?: string | null;
  // A count badge beside the label; none when undefined.
  count?: number;
}

// What the row does when its tabs don't fit on one line: wrap onto a second line,
// drop the icons first and wrap only if that's still not enough, or scroll
// sideways in one row, as on phones, where a faded edge and an arrow show there's more.
export type TabOverflow = "wrap" | "fit" | "scroll";

// A row of tabs over a bottom rule, as in the panel's history card and the
// ticket dialog. Narrow tightens the spacing so three tabs fit the 320px sidebar.
export function TabStrip<Id extends string>({ colors, tabs, selected, onSelect, narrow = false, overflow = "wrap", style }: {
  colors: Colors;
  tabs: Array<TabEntry<Id>>;
  selected: Id;
  onSelect(id: Id): void;
  narrow?: boolean;
  overflow?: TabOverflow;
  style?: object;
}) {
  // Set once the tabs wrapped with icons, for this set of tabs.
  const ids = tabs.map((entry) => entry.id).join();
  const [wrappedFor, setWrappedFor] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);
  const spans = useRef(new Map<string, { x: number; width: number }>());
  const size = useRef({ viewport: 0, content: 0, offset: 0 });
  const [hidden, setHidden] = useState({ before: false, after: false });
  const reduced = useReducedMotion();
  const scroll = overflow === "scroll";
  // Scrolling rows go without icons, so less of the row is hidden.
  const iconless = scroll || (overflow === "fit" && wrappedFor === ids);
  const gap = narrow ? 10 : 16;
  const rule = { borderBottomWidth: 1, borderBottomColor: colors.border };
  // Centers a tab in the visible part of the row, so the ones beside it show too.
  const reveal = (id: string) => {
    const span = spans.current.get(id);
    const { viewport } = size.current;
    if (!span || !viewport) return;
    scroller.current?.scrollTo({ x: Math.max(0, span.x + span.width / 2 - viewport / 2), animated: !reduced });
  };
  // A chevron press moves the row most of its width that way.
  const page = (direction: 1 | -1) => {
    const { viewport, content, offset } = size.current;
    const x = Math.min(Math.max(0, offset + direction * (viewport - 48)), content - viewport);
    scroller.current?.scrollTo({ x, animated: !reduced });
  };
  // Which ends have tabs scrolled out of sight, so those edges fade.
  const measure = (next: Partial<typeof size.current>) => {
    const s = Object.assign(size.current, next);
    const before = s.offset > 1;
    const after = s.offset + s.viewport < s.content - 1;
    if (before !== hidden.before || after !== hidden.after) setHidden({ before, after });
  };
  const items = tabs.map((entry) => (
    <Tab key={entry.id} colors={colors} narrow={narrow} entry={iconless ? { ...entry, icon: null } : entry} selected={entry.id === selected}
      onPress={() => { onSelect(entry.id); if (scroll) reveal(entry.id); }}
      onLayout={scroll ? (event) => {
        const { x, width } = event.nativeEvent.layout;
        spans.current.set(entry.id, { x, width });
        // A tab chosen earlier may sit past the edge when the dialog opens.
        if (entry.id === selected) reveal(entry.id);
      } : undefined} />
  ));
  if (scroll) {
    // Scrolling rows sit on Paseo's phone sheet, which is surface0.
    return (
      <View style={[{ position: "relative" }, style]}>
        <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" scrollEventThrottle={16}
          onLayout={(event) => { measure({ viewport: event.nativeEvent.layout.width }); reveal(selected); }}
          onContentSizeChange={(width) => measure({ content: width })}
          onScroll={(event) => measure({ offset: event.nativeEvent.contentOffset.x })}
          contentContainerStyle={{ flexGrow: 1, flexDirection: "row", columnGap: gap, ...rule }}>
          {items}
        </ScrollView>
        {hidden.before ? <EdgeFade colors={colors} side="left" onPress={() => page(-1)} /> : null}
        {hidden.after ? <EdgeFade colors={colors} side="right" onPress={() => page(1)} /> : null}
      </View>
    );
  }
  return (
    <View accessibilityRole="tablist"
      // One row is 32px (8 + 18 + 6); anything taller wrapped.
      onLayout={overflow === "fit" ? (event) => { if (!iconless && event.nativeEvent.layout.height > 40) setWrappedFor(ids); } : undefined}
      style={[{ flexDirection: "row", flexWrap: "wrap", columnGap: gap, ...rule }, style]}>
      {items}
    </View>
  );
}

const FADE_SLICES = 12;

// Fades a row that scrolls on past this edge, with a chevron at the edge, so the
// cue shows even when the next tab sits wholly out of sight. The slices stand in
// for a gradient, which React Native Web lacks (see pill-popover.tsx).
function EdgeFade({ colors, side, onPress }: { colors: Colors; side: "left" | "right"; onPress(): void }) {
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: 0, bottom: 0, [side]: 0, flexDirection: side === "right" ? "row" : "row-reverse" }}>
      {Array.from({ length: FADE_SLICES }, (_, i) => (
        <View key={i} pointerEvents="none" style={{ width: 2, backgroundColor: withAlpha(colors.surface0, (i + 1) / (FADE_SLICES + 1)) ?? undefined }} />
      ))}
      <Pressable accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onPress={onPress} hitSlop={8}
        style={{ width: 16, justifyContent: "center", alignItems: side === "right" ? "flex-end" : "flex-start", backgroundColor: colors.surface0 }}>
        <Icon name={side === "right" ? "ChevronRight" : "ChevronLeft"} size={14} color={colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}

// Instant feedback: tabs switch often, so hover and press change color only.
function Tab<Id extends string>({ colors, narrow, entry, selected, onPress, onLayout }: {
  colors: Colors;
  narrow: boolean;
  entry: TabEntry<Id>;
  selected: boolean;
  onPress(): void;
  onLayout?(event: LayoutChangeEvent): void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable accessibilityRole="tab" aria-selected={selected} onPress={onPress} onLayout={onLayout}
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
