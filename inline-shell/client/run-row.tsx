import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { basename, errorMessage } from "../shared/text.ts";
import { LIMITS } from "../shared/limits.ts";
import { plainText, type RunRow } from "../shared/row.ts";
import { dismiss, fullOutput, send, start, stop, tail } from "../shared/rpc.ts";
import { describe, formatDuration, statusText, type Action, type NoteIcon, type Presentation } from "../shared/view.ts";
import { useResolvedRun, useRunUi } from "./live.ts";
import { OutputWell } from "./output.tsx";
import { makePalette, withAlpha, type ThemeColors } from "./palette.ts";
import { Badge, Button, mono, nativeDriver, raised, toneColor, useReducedMotion, type ButtonTone } from "./ui.tsx";

const NOTE_ICON: Record<NoteIcon, string> = { "eye-off": "EyeOff", eye: "Eye", scissors: "Scissors", clock: "Clock", info: "Info" };
const ACTION_ICON: Record<Action["id"], string> = { run: "Play", dismiss: "X", stop: "Square", "force-stop": "SquareX", copy: "Copy", rerun: "RotateCw", send: "Send" };
const ENTER_WITHIN_MS = 2_000;

// The renderer for kind "run" v1. Reads the row, merges live state, asks describe() what to
// show, and paints. Holds no run state of its own.
export function RunRowView({ agentId, item, theme, layout, timestamp }: PluginTimelineItemProps<RunRow>) {
  const row = item.data;
  const colors = theme.colors;
  const rpcTail = useRpc(tail);
  const rpcStart = useRpc(start);
  const rpcStop = useRpc(stop);
  const rpcSend = useRpc(send);
  const rpcOutput = useRpc(fullOutput);
  const rpcDismiss = useRpc(dismiss);
  const run = useResolvedRun(row, rpcTail);
  const ui = useRunUi(row.runId, rpcTail);
  const running = run.phase.kind === "running" && run.lostAt === null;
  const now = useNow(running ? 1_000 : null);
  const pres = describe(run, now);
  const palette = useMemo(() => makePalette(colors), [colors]);
  const reduced = useReducedMotion();
  const toast = useToast();
  const [busy, setBusy] = useState<Action["id"] | null>(null);
  const [copied, setCopied] = useState(false);
  const compact = layout.compact;

  async function act(action: Action) {
    setBusy(action.id);
    try {
      switch (action.id) {
        case "run":
          await rpcStart({ agentId, cwd: run.cwd, command: run.command, origin: "claude", runId: run.runId });
          return;
        case "rerun":
          await rpcStart({ agentId, cwd: run.cwd, command: run.command, origin: run.origin });
          return;
        case "dismiss":
          await rpcDismiss({ agentId, runId: run.runId, command: run.command, cwd: run.cwd });
          return;
        case "stop":
          await rpcStop({ runId: run.runId, force: false });
          return;
        case "force-stop":
          await rpcStop({ runId: run.runId, force: true });
          return;
        case "copy": {
          const full = await rpcOutput({ runId: run.runId }).catch(() => null);
          await copyText(full?.text ?? plainText(run.output.lines));
          setCopied(true);
          setTimeout(() => setCopied(false), 1_200);
          return;
        }
        case "send": {
          const { delivery } = await rpcSend({ agentId, runId: run.runId, fallback: row });
          toast.show(delivery === "steered" ? "Added to Claude's current turn" : "Sent to Claude", { variant: "success" });
          return;
        }
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const actions = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {pres.actions.map((action) => (
        <Button
          key={action.id}
          icon={action.id === "copy" && copied ? "Check" : ACTION_ICON[action.id]}
          label={action.id === "copy" && copied ? "Copied" : action.label}
          tone={buttonTone(action)}
          onPress={() => void act(action)}
          busy={busy === action.id}
          disabled={action.disabled}
          compact={compact}
          iconOnly={compact && !action.primary}
          colors={colors}
          accessibilityLabel={action.label}
        />
      ))}
    </View>
  );

  if (pres.layout === "dismissed") {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4, paddingHorizontal: 8 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16 }}>Dismissed · </Text>
        <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontFamily: mono(), fontSize: 12, lineHeight: 16, flexShrink: 1 }}>{run.command}</Text>
      </View>
    );
  }

  if (pres.layout === "proposed") {
    return (
      <Enter timestamp={timestamp} reduced={reduced} entered={ui.entered} markEntered={ui.markEntered}>
        <View style={{ borderRadius: 12, backgroundColor: withAlpha(colors.surface1, 0.6), borderWidth: 1, borderStyle: "dashed", borderColor: withAlpha(colors.foregroundMuted, 0.35), overflow: "hidden" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, minHeight: 40 }}>
            <Badge kind={pres.badge} tone={pres.tone} colors={colors} />
            <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "500" }}>Claude suggests running this</Text>
            <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, maxWidth: "40%" }}>{basename(run.cwd)}</Text>
          </View>
          <View style={{ marginHorizontal: 6, marginBottom: 6, borderRadius: 6, backgroundColor: palette.well, borderWidth: 1, borderColor: withAlpha(colors.border, 0.6), paddingVertical: 8, paddingHorizontal: 10 }}>
            <Text selectable style={{ fontFamily: mono(), fontSize: 13, lineHeight: 18, fontWeight: "600", color: colors.foreground }}>
              <Text selectable={false} style={{ color: colors.foregroundMuted, fontWeight: "400" }}>$ </Text>
              {run.command}
            </Text>
          </View>
          <Footer pres={pres} colors={colors} compact={compact} actions={actions} />
        </View>
      </Enter>
    );
  }

  return (
    <Enter timestamp={timestamp} reduced={reduced} entered={ui.entered} markEntered={ui.markEntered}>
      <Card colors={colors} tone={pres.tone} running={running} seenLive={ui.seenLive} reduced={reduced}>
        <Header pres={pres} run={run} colors={colors} expanded={ui.expanded} onToggle={() => ui.setExpanded(!ui.expanded)} />
        {pres.well?.kind === "output" ? (
          <OutputWell
            lines={run.output.lines}
            skipped={pres.well.skipped}
            palette={palette}
            colors={colors}
            mode={ui.expanded ? "expanded" : "peek"}
            running={running}
            following={ui.following}
            onFollowingChange={ui.setFollowing}
            peekLines={LIMITS.peekLines}
            commandLines={run.command.split("\n")}
            reduced={reduced}
          />
        ) : pres.well?.kind === "message" ? (
          <View style={{ marginHorizontal: 6, marginBottom: 6, borderRadius: 6, backgroundColor: palette.well, borderWidth: 1, borderColor: withAlpha(colors.border, 0.6), paddingVertical: 8, paddingHorizontal: 10 }}>
            <Text selectable style={{ fontFamily: mono(), fontSize: 12, lineHeight: 18, color: colors.foreground }}>{pres.well.text}</Text>
          </View>
        ) : null}
        <Footer pres={pres} colors={colors} compact={compact} actions={actions} />
      </Card>
    </Enter>
  );
}

function buttonTone(action: Action): ButtonTone {
  if (action.id === "force-stop") return "danger-filled";
  return action.primary ? "primary" : "quiet";
}

// The card: surface, ring, the running sweep along the top edge, and one flash of the
// status color when a run this mount watched comes to an end.
function Card({ children, colors, tone, running, seenLive, reduced }: { children: React.ReactNode; colors: ThemeColors; tone: Presentation["tone"]; running: boolean; seenLive: boolean; reduced: boolean }) {
  const [width, setWidth] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const wasRunning = useRef(running);
  useEffect(() => {
    if (!running || reduced || width === 0) return;
    sweep.setValue(0);
    const loop = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 1_400, easing: Easing.inOut(Easing.ease), useNativeDriver: nativeDriver() }));
    loop.start();
    return () => loop.stop();
  }, [running, reduced, width]);
  useEffect(() => {
    if (wasRunning.current && !running && seenLive && !reduced) {
      flash.setValue(1);
      Animated.timing(flash, { toValue: 0, duration: 700, easing: Easing.out(Easing.ease), useNativeDriver: nativeDriver() }).start();
    }
    wasRunning.current = running;
  }, [running]);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const barWidth = Math.round(width * 0.28);
  return (
    <View onLayout={onLayout} style={[{ borderRadius: 12, backgroundColor: colors.surface1, overflow: "hidden" }, raised(colors)]}>
      {running ? (
        reduced ? (
          <View style={{ height: 2, backgroundColor: withAlpha(colors.accent, 0.4) }} />
        ) : (
          <View style={{ height: 2 }}>
            <Animated.View style={{ position: "absolute", top: 0, height: 2, width: barWidth, backgroundColor: withAlpha(colors.accent, 0.9), transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-barWidth, width] }) }] }} />
          </View>
        )
      ) : null}
      {children}
      <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12, borderWidth: 1, borderColor: toneColor(tone, colors), opacity: flash }} />
    </View>
  );
}

function Header({ pres, run, colors, expanded, onToggle }: { pres: Presentation; run: ReturnType<typeof useResolvedRun>; colors: ThemeColors; expanded: boolean; onToggle(): void }) {
  const [first, ...rest] = run.command.split("\n");
  const [hovered, setHovered] = useState(false);
  const rotate = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(rotate, { toValue: expanded ? 1 : 0, duration: 150, easing: Easing.out(Easing.ease), useNativeDriver: nativeDriver() }).start();
  }, [expanded]);
  const status = (
    <Text accessibilityLiveRegion="polite" style={{ color: toneColor(pres.tone, colors), fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"] }}>
      {pres.timerFrom !== null ? <Elapsed from={pres.timerFrom} prefix={pres.label ? `${pres.label} · ` : ""} /> : statusText(pres)}
    </Text>
  );
  const content = (hovered: boolean) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, minHeight: 40, backgroundColor: hovered ? withAlpha(colors.surface2, 0.5) : "transparent" }}>
      <Badge kind={pres.badge} tone={pres.tone} colors={colors} />
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: mono(), fontSize: 13, lineHeight: 18, fontWeight: "600", color: colors.foreground }}>
        <Text selectable={false} style={{ color: colors.foregroundMuted, fontWeight: "400" }}>$ </Text>
        {first}
      </Text>
      {rest.length > 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16, paddingHorizontal: 6, borderRadius: 4, backgroundColor: colors.surface2 }}>{`+${rest.length} ${rest.length === 1 ? "line" : "lines"}`}</Text> : null}
      {status}
      {pres.foldable ? (
        <Animated.View style={{ transform: [{ rotate: rotate.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "90deg"] }) }] }}>
          <Icon name="ChevronRight" size={14} color={colors.foregroundMuted} />
        </Animated.View>
      ) : null}
    </View>
  );
  if (!pres.foldable) return content(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={expanded ? "Show less output" : "Show more output"}
      accessibilityState={{ expanded }}
      onPress={onToggle}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}>
      {content(hovered)}
    </Pressable>
  );
}

function Footer({ pres, colors, compact, actions }: { pres: Presentation; colors: ThemeColors; compact: boolean; actions: React.ReactNode }) {
  const notes = [...pres.notes, ...(pres.well?.kind === "empty" ? [{ icon: "info" as const, text: pres.well.text }] : [])].slice(0, 2);
  return (
    <View style={{ paddingTop: 6, paddingHorizontal: 8, paddingBottom: 8, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 }}>
          {notes.map((note) => (
            <View key={note.text} style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}>
              <Icon name={NOTE_ICON[note.icon]} size={12} color={colors.foregroundMuted} />
              <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, flexShrink: 1 }}>{compact ? note.text.split(" ").slice(0, 2).join(" ") : note.text}</Text>
            </View>
          ))}
        </View>
        {actions}
      </View>
      {pres.hint ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4 }}>
          <View style={{ paddingTop: 2 }}><Icon name="Info" size={12} color={colors.foregroundMuted} /></View>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, flexShrink: 1 }}>{pres.hint}</Text>
        </View>
      ) : null}
    </View>
  );
}

// A live timer in its own Text, ticking every 100 ms under a minute and every second after.
function Elapsed({ from, prefix }: { from: number; prefix: string }) {
  const elapsed = Date.now() - from;
  const now = useNow(elapsed < 60_000 ? 100 : 1_000);
  return <>{prefix}{formatDuration(Math.max(0, now - from))}</>;
}

function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

// A row under two seconds old fades and rises in the first time it mounts; a virtualized
// remount does not replay it, since the store remembers the row already entered.
function Enter({ children, timestamp, reduced, entered, markEntered }: { children: React.ReactNode; timestamp: Date; reduced: boolean; entered: boolean; markEntered(): void }) {
  const [fresh] = useState(() => !entered && Date.now() - timestamp.getTime() < ENTER_WITHIN_MS);
  const enter = useRef(new Animated.Value(fresh && !reduced ? 0 : 1)).current;
  useEffect(() => {
    markEntered();
    if (!fresh || reduced) return;
    Animated.timing(enter, { toValue: 1, duration: 300, easing: Easing.out(Easing.ease), useNativeDriver: nativeDriver() }).start();
  }, []);
  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}
