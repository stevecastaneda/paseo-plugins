import { openExternalUrl } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView as NativeScrollView } from "react-native";
import type { Line, Segment } from "../shared/row.ts";
import { formatCount, peekWindow, trimBlankEnds } from "../shared/view.ts";
import type { Palette, ThemeColors } from "./palette.ts";
import { withAlpha } from "./palette.ts";
import { mono, nativeDriver } from "./ui.tsx";

export const LINE_HEIGHT = 18;
const WELL_PADDING_V = 8;
// Padding sits outside the scroller, so a view scrolled to the end never slices a line in half.
const EXPANDED_MAX = 26 * LINE_HEIGHT;
const URL = /https?:\/\/[^\s<>"')\]]+/g;

// The output well: one selectable Text so copy and selection work across lines, spans
// colored by the palette, bottom-anchored in a fixed viewport while peeking and a
// scrollable, tail-following view when expanded. https links open outside.
export function OutputWell({ lines, skipped, palette, colors, mode, running, following, onFollowingChange, peekLines, commandLines, reduced }: {
  lines: readonly Line[];
  skipped: number;
  palette: Palette;
  colors: ThemeColors;
  mode: "peek" | "expanded";
  running: boolean;
  following: boolean;
  onFollowingChange(v: boolean): void;
  peekLines: number;
  commandLines: string[];
  reduced: boolean;
}) {
  const total = skipped + lines.length;
  const trimmed = trimBlankEnds(lines, skipped === 0);
  const shown = mode === "peek" ? peekWindow(lines, skipped === 0, peekLines) : trimmed;
  const seen = useRef(total);
  const fade = useRef(new Animated.Value(1)).current;
  const freshFrom = running && total > seen.current ? Math.max(0, shown.length - (total - seen.current)) : shown.length;
  useEffect(() => {
    seen.current = total;
    if (freshFrom < shown.length && !reduced) {
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 140, useNativeDriver: nativeDriver() }).start();
    }
  }, [total]);

  const body = (
    <Text selectable style={{ fontFamily: mono(), fontSize: 12, lineHeight: LINE_HEIGHT, color: palette.text }}>
      {mode === "expanded" && commandLines.length > 1 ? <Text style={{ color: colors.foregroundMuted }}>{commandLines.map((l) => `$ ${l}`).join("\n")}{"\n"}</Text> : null}
      {mode === "expanded" && skipped > 0 ? <Text style={{ color: colors.foregroundMuted }}>{`⋯ ${formatCount(skipped)} earlier lines\n`}</Text> : null}
      {shown.slice(0, freshFrom).map((line, i) => <LineSpans key={i} line={line} palette={palette} last={i === shown.length - 1} />)}
      {freshFrom < shown.length ? (
        <Animated.Text style={{ opacity: fade }}>
          {shown.slice(freshFrom).map((line, i) => <LineSpans key={freshFrom + i} line={line} palette={palette} last={freshFrom + i === shown.length - 1} />)}
        </Animated.Text>
      ) : null}
    </Text>
  );

  const frame = {
    marginHorizontal: 10,
    borderRadius: 6,
    backgroundColor: palette.well,
    borderWidth: 1,
    borderColor: withAlpha(colors.border, 0.6),
    overflow: "hidden" as const,
  };
  const pmono = Platform.OS === "web" ? ({ dataSet: { pmono: "" } } as object) : {};

  if (mode === "expanded") {
    return (
      <View style={[frame, { paddingVertical: WELL_PADDING_V }]} {...pmono}>
        <ExpandedScroll running={running} following={following} onFollowingChange={onFollowingChange} colors={colors} fadeColor={palette.well} contentKey={total}>
          <View style={{ paddingHorizontal: 10 }}>{body}</View>
        </ExpandedScroll>
      </View>
    );
  }
  return (
    <View style={frame} {...pmono}>
      <View style={{ paddingVertical: WELL_PADDING_V, paddingHorizontal: 10 }}>{body}</View>
    </View>
  );
}

// Three stacked bands of the well color, so the top of a scrolled view fades without gradient support.
function TopFade({ color }: { color: string }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
      {[0.85, 0.55, 0.25].map((alpha) => <View key={alpha} style={{ height: 6, backgroundColor: withAlpha(color, alpha) }} />)}
    </View>
  );
}

function ExpandedScroll({ children, running, following, onFollowingChange, colors, fadeColor, contentKey }: {
  children: React.ReactNode;
  running: boolean;
  following: boolean;
  onFollowingChange(v: boolean): void;
  colors: ThemeColors;
  fadeColor: string;
  contentKey: number;
}) {
  const ref = useRef<NativeScrollView>(null);
  const [away, setAway] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (following) ref.current?.scrollToEnd({ animated: false });
  }, [contentKey, following]);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - LINE_HEIGHT;
    setAway(!atBottom);
    setScrolled(contentOffset.y > 0);
    if (running && atBottom !== following) onFollowingChange(atBottom);
  };
  return (
    <View>
      <ScrollView ref={ref} style={{ maxHeight: EXPANDED_MAX }} onScroll={onScroll} scrollEventThrottle={100}>
        {children}
      </ScrollView>
      {scrolled ? <TopFade color={fadeColor} /> : null}
      {running && away ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Jump to latest output"
          onPress={() => { onFollowingChange(true); ref.current?.scrollToEnd({ animated: true }); }}
          style={{ position: "absolute", right: 10, bottom: 8, height: 24, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.accent, justifyContent: "center" }}>
          <Text style={{ color: colors.accentForeground, fontSize: 11, lineHeight: 14, fontWeight: "600" }}>Jump to latest</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function LineSpans({ line, palette, last }: { line: Line; palette: Palette; last: boolean }) {
  const segments: Segment[] = typeof line === "string" ? [[line, ""]] : line;
  return (
    <>
      {segments.map(([text, sgr], i) => {
        const s = palette.style(sgr);
        const style = {
          color: s.fg ?? undefined,
          backgroundColor: s.bg ?? undefined,
          fontWeight: s.bold ? ("600" as const) : undefined,
          fontStyle: s.italic ? ("italic" as const) : undefined,
          textDecorationLine: s.underline && s.strike ? ("underline line-through" as const) : s.underline ? ("underline" as const) : s.strike ? ("line-through" as const) : undefined,
        };
        return <Text key={i} style={style}>{linkify(text)}</Text>;
      })}
      {last ? null : "\n"}
    </>
  );
}

function linkify(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(URL)) {
    const index = match.index ?? 0;
    if (index > at) parts.push(text.slice(at, index));
    const url = match[0];
    parts.push(<Text key={index} accessibilityRole="link" style={{ textDecorationLine: "underline" }} onPress={() => void openExternalUrl(url)}>{url}</Text>);
    at = index + url.length;
  }
  if (parts.length === 0) return text;
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}
