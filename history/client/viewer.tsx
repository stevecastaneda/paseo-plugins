import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Text, View, type ScrollView as NativeScrollView, type LayoutChangeEvent } from "react-native";
import { useRpc, type PluginButtonIconProps } from "@getpaseo/plugin/client";
import { FlatList, ScrollView, Icon, copyText } from "@getpaseo/plugin/client/react-native";
import type { RpcOutput } from "@getpaseo/plugin";
import { readHistory } from "../shared/history";
import { groupTurns, parseEntries, type HistoryEntry, type HistoryTurn } from "../shared/entries";
import { loadConversationBatch } from "./load-history";
import { HoverButton } from "./hover-button";
import { MarkdownMessage } from "./markdown";
import { TaskNotificationBody } from "./task-notification";

type Colors = PluginButtonIconProps["theme"]["colors"];
const mono = () => Platform.OS === "ios" ? "Menlo" : "monospace";

function Action({ label, icon, text, disabled = false, active = false, onPress, colors }: {
  label: string; icon: string; text?: string; disabled?: boolean; active?: boolean; onPress(): void; colors: Colors;
}) {
  return <HoverButton colors={colors} active={active} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled, selected: active }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ paddingHorizontal: text ? 10 : 7, minHeight: 32, minWidth: 32,
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 6,
      backgroundColor: pressed || active ? colors.surface2 : "transparent", opacity: disabled ? 0.4 : 1 })}>
    {color => <>
      <Icon name={icon} size={14} color={color} />
      {text ? <Text numberOfLines={1} style={{ color, fontSize: 12 }}>{text}</Text> : null}
    </>}
  </HoverButton>;
}

function RawEntry({ entry, colors, copy }: { entry: HistoryEntry; colors: Colors; copy(text: string): void }) {
  const [expanded, setExpanded] = useState(false);
  return <View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <HoverButton colors={colors} accessibilityRole="button" accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${entry.kind}`}
        accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}
        style={({ pressed }) => ({ flex: 1, flexDirection: "row", gap: 8, alignItems: "center", minHeight: 36,
          paddingHorizontal: 6, borderRadius: 4, backgroundColor: pressed ? colors.surface2 : "transparent" })}>
        {color => <>
          <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={12} color={color} />
          <View style={{ flex: 1, gap: 3, paddingVertical: 6 }}>
            <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12 }}>{entry.title}</Text>
            {!expanded ? <Text numberOfLines={2} style={{ color, fontSize: 12, lineHeight: 18 }}>{entry.preview.slice(0, 240)}</Text> : null}
          </View>
        </>}
      </HoverButton>
      <Action colors={colors} label="Copy JSON" icon="Copy" onPress={() => copy(entry.raw)} />
    </View>
    {expanded ? <View style={{ padding: 12, marginVertical: 4, borderRadius: 6, backgroundColor: colors.surface0 }}>
      <Text selectable style={{ fontFamily: mono(), color: colors.foregroundMuted, fontSize: 11, lineHeight: 18 }}>
        {entry.valid ? JSON.stringify(JSON.parse(entry.raw), null, 2) : entry.raw}
      </Text>
    </View> : null}
  </View>;
}

function Message({ entry, colors, copy, onError }: { entry: HistoryEntry; colors: Colors; copy(text: string): void; onError(message: string): void }) {
  const [raw, setRaw] = useState(false);
  const notification = entry.notification;
  const subject = notification?.summary.startsWith("Agent ") ? "Agent" : "Task";
  const label = notification ? `${subject} ${notification.status === "completed" ? "finished" : notification.status}`
    : entry.role === "user" ? "You" : "Assistant";
  const icon = notification ? notification.status === "completed" ? "Check" : notification.status === "failed" ? "CircleAlert" : "Activity"
    : entry.role === "user" ? "User" : "Sparkles";
  return <View style={{ gap: 6, paddingVertical: 10 }}>
    <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
      <Icon name={icon} size={14} color={colors.foregroundMuted} />
      <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600", flex: 1 }}>{label}</Text>
      <Action colors={colors} label="Copy message" icon="Copy" onPress={() => copy(entry.preview)} />
      <Action colors={colors} label="Show raw message" icon="Braces" active={raw} onPress={() => setRaw(!raw)} />
    </View>
    {notification ? <TaskNotificationBody notification={notification} colors={colors} copy={copy} onError={onError} />
      : <MarkdownMessage text={entry.preview} colors={colors} copy={copy} onError={onError} />}
    {raw ? <RawEntry entry={entry} colors={colors} copy={copy} /> : null}
  </View>;
}

function Turn({ turn, colors, copy, onError, onLayout }: { turn: HistoryTurn; colors: Colors; copy(text: string): void; onError(message: string): void; onLayout(event: LayoutChangeEvent): void }) {
  const [detail, setDetail] = useState<string | null>(null);
  const messages = turn.entries.filter((entry) => entry.category === "message");
  const timestamp = turn.entries.find((entry) => entry.timestamp)?.timestamp;
  const date = timestamp ? new Date(timestamp) : null;
  const tags = ([['tools', 'Tools', 'Terminal'], ['reasoning', 'Reasoning', 'Brain'], ['context', 'Context', 'Files'], ['events', 'Events', 'Activity']] as const)
    .map(([category, label, icon]) => ({ category, label, icon, entries: turn.entries.filter((entry) => entry.category === category
      || (category === "tools" && entry.hasTools) || (category === "reasoning" && entry.hasReasoning)) }))
    .filter((tag) => tag.entries.length);
  const shown = detail === "raw" ? turn.entries : tags.find((tag) => tag.category === detail)?.entries ?? [];
  return <View onLayout={onLayout} style={{ paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: messages.length ? 4 : 0 }}>
      <View style={{ flexDirection: "row", gap: 7, alignItems: "center" }}>
        <Icon name={turn.title === "Session details" ? "Info" : "MessagesSquare"} size={13} color={colors.foregroundMuted} />
        <Text accessibilityRole="header" style={{ color: colors.foregroundMuted, fontSize: 12 }}>{turn.title}</Text>
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</Text>
    </View>
    {messages.map((entry, index) => <Message key={index} entry={entry} colors={colors} copy={copy} onError={onError} />)}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 2, marginLeft: -6 }}>
      {tags.map((tag) => <Action key={tag.category} colors={colors} label={`${tag.label}: ${tag.entries.length} entries`}
        text={`${tag.label} ${tag.entries.length}`} icon={tag.icon} active={detail === tag.category}
        onPress={() => setDetail(detail === tag.category ? null : tag.category)} />)}
      <Action colors={colors} label="Raw turn entries" text="Raw" icon="Braces" active={detail === "raw"}
        onPress={() => setDetail(detail === "raw" ? null : "raw")} />
    </View>
    {detail ? <View style={{ marginTop: 4, paddingLeft: 8, borderLeftWidth: 1, borderLeftColor: colors.border }}>
      {shown.map((entry, index) => <RawEntry key={index} entry={entry} colors={colors} copy={copy} />)}
    </View> : null}
  </View>;
}

export function HistoryViewer({ agentId, theme }: PluginButtonIconProps & { agentId: string }) {
  const rpc = useRpc(readHistory);
  const [page, setPage] = useState<RpcOutput<typeof readHistory> | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState(false);
  const request = useRef(0);
  const conversationScroll = useRef<NativeScrollView>(null);
  const [scrollY, setScrollY] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [jumpTarget, setJumpTarget] = useState<{ index: number; y: number } | null>(null);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const measure = (key: string, y: number) => setPositions(previous => previous[key] === y ? previous : { ...previous, [key]: y });
  const colors = theme.colors;
  const entries = useMemo(() => parseEntries(text), [text]);
  const turns = useMemo(() => groupTurns(entries).filter((turn) => turn.title !== "Session details"
    || turn.entries.some((entry) => entry.category === "message")), [entries]);

  async function load(append = false) {
    const id = ++request.current;
    setBusy(true); setError(null); setNotice("");
    try {
      const result = await loadConversationBatch(rpc, { agentId, offset: append && page ? page.nextOffset : 0,
        ...(append && page ? { source: page.source } : {}) }, () => request.current !== id);
      if (!result || request.current !== id) return;
      if (!append) { setScrollY(0); setJumpTarget(null); if (page) conversationScroll.current?.scrollTo({ y: 0, animated: false }); }
      setPage(result.page); setText((current) => append ? current + result.text : result.text);
    } catch (reason) {
      if (request.current === id) setError(reason instanceof Error ? reason.message : "Could not read the log. Try again.");
    } finally { if (request.current === id) setBusy(false); }
  }
  useEffect(() => {
    void load();
    return () => { request.current++; };
  }, [agentId]);
  const copy = (value: string) => {
    void copyText(value).then(() => setNotice("Copied")).catch(() => setError("Could not copy. You can select the text instead."));
  };
  const turnOffsets = turns.map((_, index) => positions[`turn-${index}`]);
  const currentTurn = jumpTarget && Math.abs(scrollY - jumpTarget.y) <= 2 ? jumpTarget.index : Math.max(0, turnOffsets.findLastIndex(y => y !== undefined && y <= scrollY + 2));
  const jumpTurn = (direction: number) => {
    const y = turnOffsets[currentTurn + direction];
    if (y !== undefined) {
      const targetY = viewportHeight > 0 ? Math.min(y, Math.max(0, contentHeight - viewportHeight)) : y;
      setJumpTarget({ index: currentTurn + direction, y: targetY });
      conversationScroll.current?.scrollTo({ y: targetY, animated: true });
    }
  };
  const hasMore = page && page.nextOffset < page.totalBytes;
  return <View style={{ flex: 1, minHeight: 0 }}>
    <View style={{ flexDirection: "row", gap: 4, alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Action colors={colors} label="Conversation" text="Conversation" icon="MessagesSquare" active={!source} onPress={() => { if (source) { setScrollY(0); setJumpTarget(null); } setSource(false); }} />
      <Action colors={colors} label="Raw source" text="Source" icon="FileJson" active={source} onPress={() => setSource(true)} />
      <View style={{ flex: 1 }} />
      {busy ? <ActivityIndicator size="small" color={colors.foregroundMuted} accessibilityLabel="Loading history" />
        : <Action colors={colors} label="Refresh history" icon="RefreshCw" onPress={() => void load()} />}
    </View>
    {source && page ? <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingVertical: 10, alignItems: "flex-start" }}>
      <Icon name="FileJson" size={13} color={colors.foregroundMuted} />
      <Text selectable style={{ flex: 1, color: colors.foregroundMuted, fontSize: 11, lineHeight: 17 }}>{page.path}</Text>
      <Action colors={colors} label="Copy source path" icon="Copy" onPress={() => copy(page.path)} />
    </View> : null}
    {error ? <View style={{ flexDirection: "row", gap: 8, padding: 16 }}>
      <Icon name="CircleAlert" size={16} color={colors.statusDanger} />
      <Text accessibilityRole="alert" style={{ flex: 1, color: colors.statusDanger, fontSize: 13, lineHeight: 20 }}>{error}</Text>
    </View> : null}
    {source ? <FlatList data={entries} keyExtractor={(_, index) => String(index)} style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }} renderItem={({ item }) => <RawEntry entry={item} colors={colors} copy={copy} />} />
      : <ScrollView ref={conversationScroll} style={{ flex: 1, minHeight: 0 }} scrollEventThrottle={16}
        onLayout={event => setViewportHeight(event.nativeEvent.layout.height)} onContentSizeChange={(_, height) => setContentHeight(height)}
        onScroll={event => setScrollY(event.nativeEvent.contentOffset.y)} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        {turns.map((turn, index) => <Turn key={index} turn={turn} colors={colors} copy={copy} onError={setError}
          onLayout={event => measure(`turn-${index}`, event.nativeEvent.layout.y)} />)}
        {turns.length === 0 ? <Text style={{ color: colors.foregroundMuted, padding: 32 }}>{busy ? "Reading history…" : "No messages saved yet"}</Text> : null}
      </ScrollView>}
    <View style={{ flexDirection: "row", flexWrap: "nowrap", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
      {!source ? <View style={{ flexDirection: "row" }}>
        <Action colors={colors} label="Previous turn" icon="ChevronUp" disabled={busy || currentTurn === 0} onPress={() => jumpTurn(-1)} />
        <Action colors={colors} label="Next turn" icon="ChevronDown" disabled={busy || currentTurn >= turnOffsets.length - 1} onPress={() => jumpTurn(1)} />
      </View> : null}
      <View style={{ flex: 1 }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, minWidth: 0 }}>
        <Text accessibilityLiveRegion="polite" numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, flexShrink: 1 }}>
          {notice || (page ? `${entries.length} entries` : 'Saved on this host')}
        </Text>
        {hasMore ? <>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>·</Text>
          <HoverButton colors={colors} accessibilityRole="button" accessibilityLabel="Load more history" accessibilityState={{ disabled: busy }}
            disabled={busy} onPress={() => void load(true)}
            style={({ pressed }) => ({ minHeight: 32, paddingHorizontal: 4, justifyContent: "center", borderRadius: 4,
              opacity: busy ? 0.4 : 1, backgroundColor: pressed ? colors.surface2 : "transparent" })}>
            {color => <Text numberOfLines={1} style={{ color, fontSize: 12 }}>More</Text>}
          </HoverButton>
        </> : null}
      </View>
    </View>
  </View>;
}
