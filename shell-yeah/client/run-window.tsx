import { useAgent, useRpc, type PluginButtonContentProps } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type TextInput as NativeTextInput } from "react-native";
import { LIMITS } from "../shared/limits.ts";
import { start, suggest } from "../shared/rpc.ts";
import { basename, errorMessage, risksOf, shortCommand, splitTitle } from "../shared/text.ts";
import { capitalize } from "../shared/view.ts";
import { isLight, makePalette, withAlpha, type ThemeColors } from "./palette.ts";
import { Button, Spinner, codeSurface, mono } from "./ui.tsx";

type Listing = { kind: "loading" } | { kind: "ready"; commands: string[] } | { kind: "failed"; message: string };

// The Run pill's window: a box for any command, and the commands in the agent's last reply,
// prose included. Either one runs as a card in the chat, in the agent's folder.
export function RunWindow(props: PluginButtonContentProps) {
  if (props.context !== "agent") return null;
  return <AgentRunWindow agentId={props.agentId} colors={props.theme.colors} compact={props.layout.compact} close={props.close} />;
}

function AgentRunWindow({ agentId, colors, compact, close }: { agentId: string; colors: ThemeColors; compact: boolean; close(): void }) {
  const rpcStart = useRpc(start);
  const rpcSuggest = useRpc(suggest);
  const toast = useToast();
  const cwd = useAgent(agentId, (agent) => agent.cwd);
  const palette = useMemo(() => makePalette(colors), [colors]);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [listing, setListing] = useState<Listing>({ kind: "loading" });
  const box = useRef<NativeTextInput>(null);

  // Paseo places a pop-up in a second pass and moves it, which drops focus, so the box takes
  // focus again while the window opens. On a phone the window is a sheet, and the keyboard
  // waits until the box is tapped.
  useEffect(() => {
    if (compact) return;
    const timers = [100, 300, 600].map((ms) => setTimeout(() => {
      if (!box.current?.isFocused()) box.current?.focus();
    }, ms));
    return () => timers.forEach(clearTimeout);
  }, [compact]);

  useEffect(() => {
    let live = true;
    rpcSuggest({ agentId }).then(
      ({ commands }) => live && setListing({ kind: "ready", commands }),
      (error: unknown) => live && setListing({ kind: "failed", message: errorMessage(error) }),
    );
    return () => {
      live = false;
    };
  }, [agentId]);

  async function run(command: string) {
    const trimmed = command.trim();
    if (!trimmed || running !== null) return;
    if (!cwd) return toast.error("Paseo doesn't have this agent's folder yet. Try again in a moment.");
    setRunning(trimmed);
    try {
      await rpcStart({ agentId, cwd, command: trimmed, origin: "user" });
      close();
    } catch (error) {
      toast.error(`Couldn't run "${shortCommand(trimmed)}": ${errorMessage(error)}`);
      setRunning(null);
    }
  }

  const lines = Math.min(6, Math.max(1, text.split("\n").length));
  // 16 px on phones: iOS Safari zooms the page into a smaller box when it's tapped.
  const type = compact ? { fontSize: 16, lineHeight: 22 } : { fontSize: 12, lineHeight: 18 };
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 8 }}>
        <View style={{ borderRadius: 6, backgroundColor: palette.well, borderWidth: 1, borderColor: focused ? colors.accent : withAlpha(colors.border, 0.6), paddingHorizontal: 10, paddingVertical: compact ? 8 : 7 }} {...codeSurface()}>
          <TextInput
            ref={box}
            value={text}
            onChangeText={setText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyPress={(event) => {
              const key = event.nativeEvent as { key: string; shiftKey?: boolean };
              if (key.key === "Enter" && !key.shiftKey) {
                event.preventDefault();
                void run(text);
              }
            }}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            maxLength={LIMITS.commandChars}
            placeholder="Paste or type a command"
            placeholderTextColor={colors.foregroundMuted}
            accessibilityLabel="Command to run"
            style={{ height: lines * type.lineHeight, padding: 0, fontFamily: mono(), ...type, color: colors.foreground, outlineWidth: 0 }}
          />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}>
            <Icon name="Folder" size={12} color={colors.foregroundMuted} />
            <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, flexShrink: 1 }}>{cwd ? `Runs in ${basename(cwd)}` : "Finding the agent's folder…"}</Text>
          </View>
          <Button icon="Play" label="Run" tone="primary" onPress={() => void run(text)} busy={running === text.trim() && running !== null} disabled={!text.trim() || !cwd} compact={compact} colors={colors} accessibilityLabel="Run this command" />
        </View>
      </View>
      <View style={{ gap: 4 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, fontWeight: "500" }}>From the agent's last reply</Text>
        <Suggestions listing={listing} colors={colors} compact={compact} running={running} onRun={(command) => void run(command)} onEdit={(command) => {
          setText(command);
          box.current?.focus();
        }} />
      </View>
    </View>
  );
}

function Suggestions({ listing, colors, compact, running, onRun, onEdit }: { listing: Listing; colors: ThemeColors; compact: boolean; running: string | null; onRun(command: string): void; onEdit(command: string): void }) {
  if (listing.kind === "loading") {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 }}>
        <Spinner color={colors.foregroundMuted} size={12} />
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16 }}>Reading the reply…</Text>
      </View>
    );
  }
  if (listing.kind === "failed" || listing.commands.length === 0) {
    return <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, paddingVertical: 4 }}>{listing.kind === "failed" ? listing.message : "No commands in it. Paste one above."}</Text>;
  }
  return (
    <View style={{ marginHorizontal: -6 }}>
      {listing.commands.map((command) => (
        <Suggestion key={command} command={command} colors={colors} compact={compact} busy={running === command} disabled={running !== null} onRun={() => onRun(command)} onEdit={() => onEdit(splitTitle(command).script)} />
      ))}
    </View>
  );
}

function Suggestion({ command, colors, compact, busy, disabled, onRun, onEdit }: { command: string; colors: ThemeColors; compact: boolean; busy: boolean; disabled: boolean; onRun(): void; onEdit(): void }) {
  const { title, script } = splitTitle(command);
  const risks = risksOf(script);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  // The outer Pressable only tracks hover for the whole row, buttons included; the inner one runs.
  return (
    <Pressable
      accessible={false}
      focusable={false}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 6, paddingStart: 6, paddingEnd: 6, paddingVertical: 4, backgroundColor: pressed ? colors.border : hovered && !disabled ? colors.surface2 : "transparent" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Run ${shortCommand(command)}`}
        disabled={disabled}
        onPress={onRun}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={{ flex: 1, minWidth: 0, gap: 2, paddingVertical: compact ? 4 : 0 }}>
        {title ? <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{title}</Text> : null}
        {/* A tag sits on the command's line and drops below it only when the command is too long. */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 4 }}>
          <Text numberOfLines={title ? 1 : 2} style={{ flexShrink: 1, color: title ? colors.foregroundMuted : colors.foreground, fontFamily: mono(), fontSize: 12, lineHeight: 18 }}>{script}</Text>
          {risks.map((risk) => <RiskTag key={risk} risk={risk} colors={colors} />)}
        </View>
      </Pressable>
      <Button icon="Pencil" label="Edit" tone="ghost" onPress={onEdit} disabled={disabled} compact={compact} iconOnly colors={colors} accessibilityLabel={`Edit ${shortCommand(command)} before running`} />
      <Button icon="Play" label="Run" tone="ghost" onPress={onRun} busy={busy} disabled={disabled && !busy} compact={compact} iconOnly colors={colors} accessibilityLabel={`Run ${shortCommand(command)}`} />
    </Pressable>
  );
}

// The cards' warning, as a tag: the status badges' amber tint, so it reads as a note on the row.
function RiskTag({ risk, colors }: { risk: string; colors: ThemeColors }) {
  const tint = withAlpha(colors.statusWarning, isLight(colors) ? 0.12 : 0.14);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 20, paddingStart: 5, paddingEnd: 6, borderRadius: 4, backgroundColor: tint }}>
      <Icon name="TriangleAlert" size={12} color={colors.statusWarning} />
      <Text numberOfLines={1} style={{ color: colors.statusWarning, fontSize: 12, lineHeight: 16, fontWeight: "500" }}>{capitalize(risk)}</Text>
    </View>
  );
}
