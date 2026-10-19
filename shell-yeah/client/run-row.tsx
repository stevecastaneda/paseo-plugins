import { useAgent, useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import { basename, errorMessage } from "../shared/text.ts";
import { LIMITS } from "../shared/limits.ts";
import { plainText, type RunRow } from "../shared/row.ts";
import { dismiss, fullOutput, input, send, start, stop, tail } from "../shared/rpc.ts";
import { agentName, capitalize, describe, formatDuration, statusText, type Action, type NoteIcon, type Presentation } from "../shared/view.ts";
import { useResolvedRun, useRunUi } from "./live.ts";
import { OutputWell } from "./output.tsx";
import { makePalette, mix, withAlpha, type ThemeColors } from "./palette.ts";
import { Badge, Button, IconSwap, mono, nativeDriver, raised, toneColor, useReducedMotion, type ButtonTone } from "./ui.tsx";

const NOTE_ICON: Record<NoteIcon, string> = { "eye-off": "EyeOff", eye: "Eye", scissors: "Scissors", clock: "Clock", info: "Info", folder: "Folder" };
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
  const agent = agentName(useAgent(agentId, (a) => a.provider));
  const pres = describe(run, now, { agent });
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
          // A suggestion has no output yet, so its Copy copies the command.
          const full = pres.layout === "proposed" ? null : await rpcOutput({ runId: run.runId }).catch(() => null);
          await copyText(pres.layout === "proposed" ? pres.script : full?.text ?? plainText(run.output.lines));
          setCopied(true);
          setTimeout(() => setCopied(false), 1_200);
          return;
        }
        case "send": {
          const { delivery } = await rpcSend({ agentId, runId: run.runId, fallback: row });
          toast.show(delivery === "steered" ? `Added to ${agent}'s current turn` : `Sent to ${agent}`, { variant: "success" });
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
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {pres.actions.map((action) => (
        <Button
          key={action.id}
          icon={action.id === "copy" && copied ? "Check" : ACTION_ICON[action.id]}
          label={action.id === "copy" && copied ? "Copied" : action.label}
          reserveLabel={action.id === "copy" ? "Copied" : undefined}
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
      <View testID="shell-yeah-run" style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4, paddingHorizontal: 12 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16 }}>Dismissed · </Text>
        <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontFamily: mono(), fontSize: 12, lineHeight: 16, flexShrink: 1 }}>{pres.script}</Text>
      </View>
    );
  }

  if (pres.layout === "proposed") {
    return (
      <Enter timestamp={timestamp} reduced={reduced} entered={ui.entered} markEntered={ui.markEntered}>
        <View testID="shell-yeah-run" style={{ borderRadius: 12, backgroundColor: mix(colors.surface0, colors.surface1, 0.6), borderWidth: 1, borderStyle: "dashed", borderColor: withAlpha(colors.foregroundMuted, 0.35), overflow: "hidden" }}>
          <ProposalHeader pres={pres} colors={colors} />
          <Footer pres={pres} colors={colors} compact={compact} actions={actions} />
        </View>
      </Enter>
    );
  }

  return (
    <Enter timestamp={timestamp} reduced={reduced} entered={ui.entered} markEntered={ui.markEntered}>
      <Card colors={colors} tone={pres.tone} running={running} seenLive={ui.seenLive} reduced={reduced}>
        <Header pres={pres} colors={colors} expanded={ui.expanded} onToggle={() => ui.setExpanded(!ui.expanded)} />
        {pres.well?.kind === "output" ? (
          <OutputWell
            lines={run.output.lines}
            skipped={pres.well.skipped}
            palette={palette}
            colors={colors}
            tall={ui.expanded}
            rows={pres.boxLines}
            compact={compact}
            running={running}
            following={ui.following}
            onFollowingChange={ui.setFollowing}
            commandLines={pres.script.split("\n")}
            reduced={reduced}
          />
        ) : pres.well?.kind === "message" ? (
          <View style={{ marginHorizontal: 6, borderRadius: 6, backgroundColor: palette.well, borderWidth: 1, borderColor: withAlpha(colors.border, 0.6), paddingVertical: 8, paddingHorizontal: 10 }}>
            <Text selectable style={{ fontFamily: mono(), fontSize: 12, lineHeight: 18, color: colors.foreground }}>{pres.well.text}</Text>
          </View>
        ) : null}
        {pres.keyboard ? <TypeBox runId={run.runId} colors={colors} well={palette.well} compact={compact} /> : null}
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
    <View testID="shell-yeah-run" onLayout={onLayout} style={[{ borderRadius: 12, backgroundColor: colors.surface1, overflow: "hidden", borderWidth: 1, borderColor: "transparent" }, raised(colors)]}>
      {running ? (
        reduced ? (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, zIndex: 1, backgroundColor: withAlpha(colors.accent, 0.4) }} />
        ) : (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, zIndex: 1 }}>
            <Animated.View style={{ position: "absolute", top: 0, height: 2, width: barWidth, backgroundColor: withAlpha(colors.accent, 0.9), transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-barWidth, width] }) }] }} />
          </View>
        )
      ) : null}
      {children}
      <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12, borderWidth: 1, borderColor: toneColor(tone, colors), opacity: flash }} />
    </View>
  );
}

// A suggestion: the agent's title, the whole command it would run, and a warning when
// that command is hard to undo. The first line's height sets where the badge and status sit.
function ProposalHeader({ pres, colors }: { pres: Presentation; colors: ThemeColors }) {
  const firstLine = pres.title ? 20 : 18;
  const command = (
    <Text selectable style={{ fontFamily: mono(), fontSize: pres.title ? 12 : 13, lineHeight: 18, fontWeight: pres.title ? "400" : "600", color: colors.foreground }}>
      <Text selectable={false} style={{ color: colors.foregroundMuted, fontWeight: "400" }}>$ </Text>
      {pres.script}
    </Text>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 10, paddingHorizontal: 12 }}>
      <View style={{ marginTop: (firstLine - 20) / 2 }}>
        <Badge kind={pres.badge} tone={pres.tone} colors={colors} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        {pres.title ? <Text selectable style={{ fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.foreground }}>{pres.title}</Text> : null}
        {command}
        {pres.warning ? (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 1 }}>
            <View style={{ paddingTop: 3 }}><Icon name="TriangleAlert" size={12} color={colors.statusWarning} /></View>
            <Text style={{ color: colors.statusWarning, fontSize: 12, lineHeight: 18, flexShrink: 1 }}>{pres.warning}</Text>
          </View>
        ) : null}
      </View>
      <Text style={{ marginTop: (firstLine - 16) / 2, color: toneColor(pres.tone, colors), fontSize: 12, lineHeight: 16 }}>{pres.label}</Text>
    </View>
  );
}

function Header({ pres, colors, expanded, onToggle }: { pres: Presentation; colors: ThemeColors; expanded: boolean; onToggle(): void }) {
  const [first, ...rest] = pres.script.split("\n");
  const [hovered, setHovered] = useState(false);
  const rotate = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(rotate, { toValue: expanded ? 1 : 0, duration: 150, easing: Easing.out(Easing.ease), useNativeDriver: nativeDriver() }).start();
  }, [expanded]);
  const status = (
    <Text accessibilityLiveRegion="polite" numberOfLines={1} style={{ flexShrink: 0, color: toneColor(pres.tone, colors), fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"] }}>
      {pres.timerFrom !== null ? <Elapsed from={pres.timerFrom} prefix={pres.label ? `${pres.label} · ` : ""} /> : statusText(pres)}
    </Text>
  );
  const content = (hovered: boolean) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, minHeight: 40, backgroundColor: hovered ? withAlpha(colors.surface2, 0.5) : "transparent" }}>
      <Badge kind={pres.badge} tone={pres.tone} colors={colors} />
      <Text numberOfLines={expanded ? undefined : 1} style={{ flex: 1, minWidth: 0, fontFamily: mono(), fontSize: 13, lineHeight: 18, fontWeight: "600", color: colors.foreground }}>
        <Text selectable={false} style={{ color: colors.foregroundMuted, fontWeight: "400" }}>$ </Text>
        {first}
      </Text>
      {rest.length > 0 ? <Text numberOfLines={1} style={{ flexShrink: 0, color: colors.foregroundMuted, fontSize: 11, lineHeight: 16, paddingHorizontal: 6, borderRadius: 4, backgroundColor: colors.surface2 }}>{`+${rest.length} ${rest.length === 1 ? "line" : "lines"}`}</Text> : null}
      {status}
      <IconSwap swapKey={pres.foldable ? "fold" : "none"} size={14}>
        {pres.foldable ? (
          <Animated.View style={{ transform: [{ rotate: rotate.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "90deg"] }) }] }}>
            <Icon name="ChevronRight" size={14} color={colors.foregroundMuted} />
          </Animated.View>
        ) : null}
      </IconSwap>
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

// Types into the command's terminal: a line and Enter, as at a prompt. Masked, since what a
// prompt wants is often a password or a code; the terminal echoes it when the prompt shows typing.
function TypeBox({ runId, colors, well, compact }: { runId: string; colors: ThemeColors; well: string; compact: boolean }) {
  const rpcInput = useRpc(input);
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      await rpcInput({ runId, text });
      setText("");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ marginHorizontal: 10, marginTop: 6, flexDirection: "row", alignItems: "center", gap: 8, height: compact ? 40 : 34, paddingStart: 10, paddingEnd: 3, borderRadius: 6, backgroundColor: well, borderWidth: 1, borderColor: focused ? colors.accent : withAlpha(colors.border, 0.6) }}>
      <Icon name="Keyboard" size={14} color={colors.foregroundMuted} />
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => void submit()}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        submitBehavior="submit"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        maxLength={LIMITS.inputChars}
        placeholder="Type here, then press Enter"
        placeholderTextColor={colors.foregroundMuted}
        accessibilityLabel="Type into the command"
        style={{ flex: 1, minWidth: 0, height: "100%", paddingVertical: 0, fontSize: 13, color: colors.foreground, outlineWidth: 0 }}
      />
      <Button icon="CornerDownLeft" label="Enter" tone="quiet" onPress={() => void submit()} busy={busy} compact={compact} iconOnly radius={3} colors={colors} accessibilityLabel="Press Enter" />
    </View>
  );
}

function Footer({ pres, colors, compact, actions }: { pres: Presentation; colors: ThemeColors; compact: boolean; actions: React.ReactNode }) {
  const notes = [...pres.notes, ...(pres.well?.kind === "empty" ? [{ icon: "info" as const, text: pres.well.text }] : [])].slice(0, compact ? 1 : 2);
  return (
    <View style={{ padding: 6, gap: 6 }}>
      <View style={compact ? { gap: 8 } : { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1, paddingStart: 6 }}>
          {notes.map((note) => (
            <View key={note.text} style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}>
              <Icon name={NOTE_ICON[note.icon]} size={12} color={colors.foregroundMuted} />
              <Text numberOfLines={compact ? 2 : 1} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, flexShrink: 1, fontVariant: ["tabular-nums"] }}>{note.text}</Text>
            </View>
          ))}
        </View>
        <View style={compact ? { alignSelf: "flex-end" } : { marginStart: "auto" }}>{actions}</View>
      </View>
      {pres.hint ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4, paddingStart: 6, paddingBottom: 2 }}>
          <View style={{ paddingTop: 3 }}><Icon name="Info" size={12} color={colors.foregroundMuted} /></View>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, flexShrink: 1 }}>{pres.hint}</Text>
        </View>
      ) : null}
    </View>
  );
}

// A live timer in its own Text, ticking every 100 ms while it shows tenths and every second after.
function Elapsed({ from, prefix }: { from: number; prefix: string }) {
  const elapsed = Date.now() - from;
  const now = useNow(elapsed < 10_000 ? 100 : 1_000);
  // A stopwatch starts at 0.0s; "<0.1s" is for runs that are already over.
  const ms = Math.max(0, now - from);
  return <>{prefix}{ms < 100 ? "0.0s" : formatDuration(ms)}</>;
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
