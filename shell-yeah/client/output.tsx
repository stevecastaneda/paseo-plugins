import { openExternalUrl } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView as NativeScrollView } from "react-native";
import type { Line, Segment } from "../shared/row.ts";
import { LIMITS } from "../shared/limits.ts";
import { formatCount, trimBlankEnds } from "../shared/view.ts";
import type { Palette, ThemeColors } from "./palette.ts";
import { withAlpha } from "./palette.ts";
import { Button, mono, nativeDriver } from "./ui.tsx";

export const LINE_HEIGHT = 18;
const WELL_PADDING_V = 8;
const URL = /https?:\/\/[^\s<>"')\]]+/g;

// The output well: one selectable Text so copy and selection work across lines, spans
// colored by the palette, in a box that scrolls back through everything the card holds
// and follows the newest line. https links open outside.
export function OutputWell({ lines: liveLines, skipped: liveSkipped, palette, colors, tall, rows, compact, running, following, onFollowingChange, commandLines, reduced }: {
  lines: readonly Line[];
  skipped: number;
  palette: Palette;
  colors: ThemeColors;
  tall: boolean;
  rows: number;
  compact: boolean;
  running: boolean;
  following: boolean;
  onFollowingChange(v: boolean): void;
  commandLines: string[];
  reduced: boolean;
}) {
  const screen = useWindowDimensions();
  // While the user reads above the newest line of a running command, hold what they're
  // reading: past the scrollback limit the oldest lines drop off the top, which would
  // slide the text up under them. Jump to latest, or the run ending, lets go.
  const held = useRef<{ lines: readonly Line[]; skipped: number } | null>(null);
  if (following || !running) held.current = null;
  else held.current ??= { lines: liveLines, skipped: liveSkipped };
  const { lines, skipped } = held.current ?? { lines: liveLines, skipped: liveSkipped };
  const total = skipped + lines.length;
  const shown = trimBlankEnds(lines, skipped === 0);
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
      {tall && commandLines.length > 1 ? <Text style={{ color: colors.foregroundMuted }}>{commandLines.map((l) => `$ ${l}`).join("\n")}{"\n"}</Text> : null}
      {skipped > 0 ? <Text style={{ color: colors.foregroundMuted }}>{`… ${formatCount(skipped)} earlier ${skipped === 1 ? "line" : "lines"}\n`}</Text> : null}
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

  // Vertical padding sits outside the scroller, so a box scrolled to the end never slices its
  // last line; half a row at the top shows there is more above.
  return (
    <View style={[frame, { paddingVertical: WELL_PADDING_V }]} {...pmono}>
      <TailScroll maxHeight={(boxRows(tall ? LIMITS.tallBoxLines : rows, compact, screen.height) + 0.5) * LINE_HEIGHT} compact={compact} following={following} onFollowingChange={onFollowingChange} colors={colors} fadeColor={palette.well}>
        <View style={{ paddingHorizontal: 10 }}>{body}</View>
      </TailScroll>
    </View>
  );
}

// On a phone a box never takes more than 40% of the screen, so a drag can still reach the chat.
function boxRows(rows: number, compact: boolean, windowHeight: number): number {
  return compact ? Math.max(4, Math.min(rows, Math.floor((0.4 * windowHeight) / LINE_HEIGHT))) : rows;
}

// Three bands of the well color over the half row at a cut edge, without gradient support.
function EdgeFade({ color, edge }: { color: string; edge: "top" | "bottom" }) {
  const alphas = edge === "top" ? [0.85, 0.55, 0.25] : [0.25, 0.55, 0.85];
  return (
    <View pointerEvents="none" style={{ position: "absolute", [edge]: 0, left: 0, right: 0 }}>
      {alphas.map((alpha) => <View key={alpha} style={{ height: LINE_HEIGHT / 6, backgroundColor: withAlpha(color, alpha) }} />)}
    </View>
  );
}

// Stays pinned to the newest line until the user scrolls up, and pins again once they
// scroll back to the bottom or press Jump to latest.
function TailScroll({ children, maxHeight, compact, following, onFollowingChange, colors, fadeColor }: {
  children: React.ReactNode;
  maxHeight: number;
  compact: boolean;
  following: boolean;
  onFollowingChange(v: boolean): void;
  colors: ThemeColors;
  fadeColor: string;
}) {
  const ref = useRef<NativeScrollView>(null);
  const [away, setAway] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // The last known geometry. `content` is the height before the newest output landed.
  const metrics = useRef({ offset: 0, viewport: 0, content: 0 });

  // Read the scroll position as it is right now: a wheel can move it after the last
  // throttled onScroll, and new output must not undo that.
  const atBottom = () => {
    const node = Platform.OS === "web" ? (ref.current as unknown as { getScrollableNode?(): { scrollTop: number; clientHeight: number } } | null)?.getScrollableNode?.() : undefined;
    const m = metrics.current;
    const offset = node ? node.scrollTop : m.offset;
    const viewport = node ? node.clientHeight : m.viewport;
    return offset + viewport >= m.content - LINE_HEIGHT;
  };
  const onContentSizeChange = (_width: number, height: number) => {
    if (metrics.current.content === 0) ref.current?.scrollToEnd({ animated: false });
    else if (following) {
      if (atBottom()) ref.current?.scrollToEnd({ animated: false });
      else onFollowingChange(false);
    }
    metrics.current.content = height;
  };
  useEffect(() => {
    if (following) ref.current?.scrollToEnd({ animated: false });
  }, [following, maxHeight]);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    metrics.current = { offset: contentOffset.y, viewport: layoutMeasurement.height, content: contentSize.height };
    const bottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - LINE_HEIGHT;
    setAway(!bottom);
    setScrolled(contentOffset.y > 0);
    if (bottom !== following) onFollowingChange(bottom);
  };
  return (
    <View>
      <ScrollView ref={ref} nestedScrollEnabled style={{ maxHeight }} onScroll={onScroll} onContentSizeChange={onContentSizeChange} scrollEventThrottle={16}>
        {children}
      </ScrollView>
      {scrolled ? <EdgeFade color={fadeColor} edge="top" /> : null}
      {away ? <EdgeFade color={fadeColor} edge="bottom" /> : null}
      {away ? (
        <View style={{ position: "absolute", end: 8, bottom: 0 }}>
          <Button
            icon="ArrowDown"
            label="Jump to latest"
            tone="quiet"
            compact={compact}
            iconOnly={compact}
            floating
            colors={colors}
            accessibilityLabel="Jump to latest output"
            onPress={() => { onFollowingChange(true); ref.current?.scrollToEnd({ animated: false }); }}
          />
        </View>
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
