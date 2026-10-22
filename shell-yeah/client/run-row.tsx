import { useAgent, useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import { terminalKeys, type KeyPress } from "../shared/keys.ts";
import { basename, errorMessage } from "../shared/text.ts";
import { LIMITS } from "../shared/limits.ts";
import { plainText, type RunRow } from "../shared/row.ts";
import { dismiss, fullOutput, input, send, start, stop, tail } from "../shared/rpc.ts";
import { agentName, capitalize, describe, formatDuration, pastRow, pastRunView, statusText, switcher, type Action, type NoteIcon, type Presentation, type RunInView } from "../shared/view.ts";
import { useResolvedRun, useRunUi } from "./live.ts";
import { OutputWell } from "./output.tsx";
import { makePalette, mix, withAlpha, type ThemeColors } from "./palette.ts";
import { Badge, Button, IconSwap, PressScale, mono, nativeDriver, raised, toneColor, useReducedMotion, type ButtonTone } from "./ui.tsx";

const NOTE_ICON: Record<NoteIcon, string> = { "eye-off": "EyeOff", eye: "Eye", scissors: "Scissors", clock: "Clock", info: "Info", folder: "Folder", keyboard: "Keyboard" };
const ACTION_ICON: Record<Action["id"], string> = { run: "Play", dismiss: "X", stop: "Square", "force-stop": "SquareX", copy: "Copy", rerun: "RotateCw", send: "Send" };
const ENTER_WITHIN_MS = 2_000;
const STACK_SWITCHER_BELOW = 560;

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
  const latest = useResolvedRun(row, rpcTail);
  const [picked, setPicked] = useState<{ runId: string; at: number } | null>(null);
  const viewing: RunInView = picked?.runId === row.runId && row.past?.[picked.at] ? picked.at : "latest";
  const past = viewing === "latest" ? null : row.past![viewing];
  const run = past ? pastRunView(row, past) : latest;
  const steps = switcher(row, viewing);
  const keyInput = useRef<TextInput>(null);
  const [typing, setTyping] = useState(false);
  // Set by Run and Rerun. Not on a phone, where focusing opens the keyboard over the chat.
  const focusWhenListening = useRef(false);
  const ui = useRunUi(row.runId, rpcTail);
  const running = run.phase.kind === "running" && run.lostAt === null;
  const latestRunning = latest.phase.kind === "running" && latest.lostAt === null;
  const newerRunning = past !== null && latestRunning;
  const now = useNow(running ? 1_000 : null);
  const agent = agentName(useAgent(agentId, (a) => a.provider));
  const pres = describe(run, now, { agent });
  const palette = useMemo(() => makePalette(colors), [colors]);
  const reduced = useReducedMotion();
  const toast = useToast();
  const [busy, setBusy] = useState<Action["id"] | null>(null);
  const [copied, setCopied] = useState(false);
  const compact = layout.compact;
  const listening = pres.keyboard && typing;
  // Unmounting a focused input may not fire onBlur on web.
  useEffect(() => {
    if (!pres.keyboard) setTyping(false);
    else if (focusWhenListening.current) {
      focusWhenListening.current = false;
      keyInput.current?.focus();
    }
  }, [pres.keyboard]);

  async function act(action: Action) {
    setBusy(action.id);
    try {
      switch (action.id) {
        case "run":
          focusWhenListening.current = !compact;
          await rpcStart({ agentId, cwd: run.cwd, command: run.command, origin: "claude", runId: run.runId });
          return;
        case "rerun":
          focusWhenListening.current = !compact;
          await rpcStart({ agentId, cwd: row.cwd, command: row.command, origin: row.origin, rerunOf: row });
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
          const { delivery } = await rpcSend({ agentId, runId: run.runId, fallback: past ? pastRow(row, past) : row });
          toast.show(delivery === "steered" ? `Added to ${agent}'s current turn` : `Sent to ${agent}`, { variant: "success" });
          return;
        }
      }
    } catch (error) {
      focusWhenListening.current = false;
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const actions = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {pres.actions.filter((action) => !(action.id === "rerun" && newerRunning)).map((action) => (
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

  if (pres.layout === "dismissed") return null;

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
      <Card colors={colors} tone={pres.tone} running={latestRunning} showingEarlierRun={past !== null} seenLive={ui.seenLive} reduced={reduced}>
        <Header pres={pres} colors={colors} compact={compact} expanded={ui.expanded} onToggle={() => ui.setExpanded(!ui.expanded)}
          steps={steps} newerRunning={newerRunning} onStep={(to) => setPicked(to === "latest" ? null : { runId: row.runId, at: to })} />
        {pres.well?.kind === "output" ? (
          <OutputWell
            lines={run.output.lines}
            skipped={pres.well.skipped}
            palette={palette}
            colors={colors}
            tall={ui.expanded}
            box={pres.box}
            compact={compact}
            running={running}
            following={ui.following}
            onFollowingChange={ui.setFollowing}
            commandLines={pres.script.split("\n")}
            reduced={reduced}
            cursor={listening ? run.cursor : null}
            listening={listening}
            onPress={pres.keyboard ? () => keyInput.current?.focus() : undefined}>
            {pres.keyboard ? <KeyInput ref={keyInput} runId={run.runId} compact={compact} onTypingChange={setTyping} /> : null}
          </OutputWell>
        ) : pres.well?.kind === "message" ? (
          <View style={{ marginHorizontal: 6, borderRadius: 6, backgroundColor: palette.well, borderWidth: 1, borderColor: withAlpha(colors.border, 0.6), paddingVertical: 8, paddingHorizontal: 10 }}>
            <Text selectable style={{ fontFamily: mono(), fontSize: 12, lineHeight: 18, color: colors.foreground }}>{pres.well.text}</Text>
          </View>
        ) : null}
        <Footer pres={withTypingCue(pres, listening, compact)} colors={colors} compact={compact} actions={actions} />
      </Card>
    </Enter>
  );
}

function withTypingCue(pres: Presentation, listening: boolean, compact: boolean): Presentation {
  if (listening) return { ...pres, hint: null, notes: compact ? pres.notes : [{ icon: "keyboard", text: "Esc to stop typing" }, ...pres.notes] };
  const hintSaysHowToType = pres.hint !== null;
  if (!pres.keyboard || hintSaysHowToType) return pres;
  return { ...pres, notes: [{ icon: "keyboard", text: `${compact ? "Tap" : "Click"} the output to type` }, ...pres.notes] };
}

function buttonTone(action: Action): ButtonTone {
  if (action.id === "force-stop") return "danger-filled";
  return action.primary ? "primary" : "quiet";
}

// The card: surface, ring, the running sweep along the top edge, and one flash of the
// status color when a run this mount watched comes to an end.
function Card({ children, colors, tone, running, showingEarlierRun, seenLive, reduced }: { children: React.ReactNode; colors: ThemeColors; tone: Presentation["tone"]; running: boolean; showingEarlierRun: boolean; seenLive: boolean; reduced: boolean }) {
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
    if (wasRunning.current && !running && seenLive && !reduced && !showingEarlierRun) {
      flash.setValue(1);
      Animated.timing(flash, { toValue: 0, duration: 700, easing: Easing.out(Easing.ease), useNativeDriver: nativeDriver() }).start();
    }
    wasRunning.current = running;
  }, [running]);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const barWidth = Math.round(width * 0.28);
  return (
    <View testID="shell-yeah-run" onLayout={onLayout} style={[{ borderRadius: 12, backgroundColor: colors.surface1, overflow: "hidden", borderWidth: 1, borderColor: "transparent" }, raised(colors)]}>
      {running && !showingEarlierRun ? (
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

type Steps = ReturnType<typeof switcher>;

function Header({ pres, colors, compact, expanded, onToggle, steps, newerRunning, onStep }: { pres: Presentation; colors: ThemeColors; compact: boolean; expanded: boolean; onToggle(): void; steps: Steps; newerRunning: boolean; onStep(to: RunInView): void }) {
  const [first, ...rest] = pres.script.split("\n");
  const [hovered, setHovered] = useState(false);
  const [width, setWidth] = useState(0);
  const stacked = compact || (width > 0 && width < STACK_SWITCHER_BELOW);
  const command = useCutOff();
  const foldable = pres.foldable || command.cutOff;
  const rotate = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(rotate, { toValue: expanded ? 1 : 0, duration: 150, easing: Easing.out(Easing.ease), useNativeDriver: nativeDriver() }).start();
  }, [expanded]);
  const status = (
    <Text accessibilityLiveRegion="polite" numberOfLines={1} style={{ flexShrink: 0, color: toneColor(pres.tone, colors), fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"] }}>
      {pres.timerFrom !== null ? <Elapsed from={pres.timerFrom} prefix={pres.label ? `${pres.label} · ` : ""} /> : statusText(pres)}
    </Text>
  );
  const switcher = steps ? <Switcher steps={steps} colors={colors} compact={compact} newerRunning={newerRunning} onStep={onStep} /> : null;
  const content = (hovered: boolean) => (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ gap: 4, paddingVertical: 10, paddingHorizontal: 12, minHeight: 40, backgroundColor: hovered ? withAlpha(colors.surface2, 0.5) : "transparent" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Badge kind={pres.badge} tone={pres.tone} colors={colors} />
        <Text onLayout={command.onShownLayout} numberOfLines={expanded ? undefined : 1} style={{ flex: 1, minWidth: 0, fontFamily: mono(), fontSize: 13, lineHeight: 18, fontWeight: "600", color: colors.foreground }}>
          <Text selectable={false} style={{ color: colors.foregroundMuted, fontWeight: "400" }}>$ </Text>
          {first}
        </Text>
        <Text aria-hidden selectable={false} pointerEvents="none" onLayout={command.onFullLayout} numberOfLines={1} style={{ position: "absolute", left: 0, top: 0, opacity: 0, fontFamily: mono(), fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{`$ ${first}`}</Text>
        {rest.length > 0 ? <Text numberOfLines={1} style={{ flexShrink: 0, color: colors.foregroundMuted, fontSize: 11, lineHeight: 16, paddingHorizontal: 6, borderRadius: 4, backgroundColor: colors.surface2 }}>{`+${rest.length} ${rest.length === 1 ? "line" : "lines"}`}</Text> : null}
        {stacked ? null : switcher}
        {status}
        <IconSwap swapKey={foldable ? "fold" : "none"} size={14}>
          {foldable ? (
            <Animated.View style={{ transform: [{ rotate: rotate.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "90deg"] }) }] }}>
              <Icon name="ChevronRight" size={14} color={colors.foregroundMuted} />
            </Animated.View>
          ) : null}
        </IconSwap>
      </View>
      {stacked && switcher ? <View style={{ flexDirection: "row", paddingStart: 18 }}>{switcher}</View> : null}
    </View>
  );
  if (!foldable) return content(false);
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

function Switcher({ steps, colors, compact, newerRunning, onStep }: { steps: NonNullable<Steps>; colors: ThemeColors; compact: boolean; newerRunning: boolean; onStep(to: RunInView): void }) {
  const size = compact ? 28 : 24;
  const arrow = (icon: string, label: string, to: RunInView | null, live = false) => (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: to === null }}
      disabled={to === null}
      onPress={() => to !== null && onStep(to)}
      style={({ hovered }) => ({ width: size, height: size, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: hovered && to !== null ? colors.surface2 : "transparent", opacity: to === null ? 0.35 : 1 })}>
      <Icon name={icon} size={14} color={live ? colors.accent : colors.foregroundMuted} />
      {live ? <View style={{ position: "absolute", top: size / 2 - 7, right: size / 2 - 7, width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.accent }} /> : null}
    </PressScale>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, marginVertical: -(size - 20) / 2 }}>
      {arrow("ChevronLeft", "Earlier run", steps.prev)}
      <Text accessibilityLiveRegion="polite" numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"] }}>{steps.label}</Text>
      {arrow("ChevronRight", newerRunning ? "Later run, still running" : "Later run", steps.next, newerRunning)}
    </View>
  );
}

// Typing into the command, as in a terminal: each key goes to it as it's pressed. The input
// is invisible and stays empty, at the bottom of the output box, so focusing it keeps the card in
// view and a phone keyboard opens just under the newest output. What the command shows lands in
// the output, so a password prompt shows nothing. Esc stops typing.
const KeyInput = forwardRef<TextInput, { runId: string; compact: boolean; onTypingChange(typing: boolean): void }>(function KeyInput({ runId, compact, onTypingChange }, ref) {
  const send = useKeySender(runId);
  const input = useRef<TextInput | null>(null);
  const setRef = (node: TextInput | null) => {
    input.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };
  return (
    <TextInput
      ref={setRef}
      value=""
      onChangeText={(text) => {
        if (text) send(text);
      }}
      onKeyPress={(event) => {
        const press = event.nativeEvent as KeyPress;
        if (press.key === "Escape") return input.current?.blur();
        // On phones Enter arrives as a submit instead.
        if (press.key === "Enter" && Platform.OS !== "web") return;
        const keys = terminalKeys(press);
        if (keys === null) return;
        event.preventDefault();
        send(keys);
      }}
      onSubmitEditing={() => send("\r")}
      submitBehavior="submit"
      onFocus={() => onTypingChange(true)}
      onBlur={() => {
        onTypingChange(false);
        // Still focused after a blur means the window went to the background. Coming back would
        // focus the input again without a click, and the next key would go to the command.
        if (input.current === (globalThis as { document?: { activeElement: unknown } }).document?.activeElement) input.current?.blur();
      }}
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="off"
      spellCheck={false}
      caretHidden
      accessibilityLabel="Type into the command"
      accessibilityHint="Each key goes to the command as you press it"
      // 16 px on phones: iOS Safari zooms the page into a smaller box when it's tapped.
      style={{ position: "absolute", left: 0, bottom: 0, width: 1, height: 1, padding: 0, opacity: 0, fontSize: compact ? 16 : 13, color: "transparent", outlineWidth: 0 }}
    />
  );
});

// Sends keys in the order they were pressed, one request at a time, joining what was typed
// while a request was out. Pastes past the request limit go in pieces.
function useKeySender(runId: string): (keys: string) => void {
  const rpcInput = useRpc(input);
  const toast = useToast();
  const queue = useRef({ pending: [] as string[], sending: false });
  return useCallback((keys: string) => {
    const q = queue.current;
    q.pending.push(...keys);
    if (q.sending) return;
    q.sending = true;
    void (async () => {
      try {
        while (q.pending.length > 0) {
          // Half the limit in characters: one character can take two of the limit's units.
          const chunk = q.pending.splice(0, LIMITS.inputChars / 2).join("");
          await rpcInput({ runId, keys: chunk });
        }
      } catch (error) {
        q.pending = [];
        toast.error(errorMessage(error));
      } finally {
        q.sending = false;
      }
    })();
  }, [runId]);
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

// Compares the width a one-line text gets with the width an unconstrained copy of it needs.
function useCutOff(): { cutOff: boolean; onShownLayout(event: LayoutChangeEvent): void; onFullLayout(event: LayoutChangeEvent): void } {
  const [shown, setShown] = useState(0);
  const [full, setFull] = useState(0);
  return {
    cutOff: shown > 0 && full > shown + 1,
    onShownLayout: (event) => setShown(event.nativeEvent.layout.width),
    onFullLayout: (event) => setFull(event.nativeEvent.layout.width),
  };
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
