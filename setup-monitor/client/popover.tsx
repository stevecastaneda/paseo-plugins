import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { SetupCommand, SetupSnapshot, SetupStatus } from "../shared/setup";
import {
  failedCommand,
  formatDuration,
  headline,
  processCarriageReturns,
  runningCommand,
} from "../shared/snapshot";

type PluginTheme = PluginButtonContentProps["theme"];
type Colors = PluginTheme["colors"];

const LOG_HEIGHT = 200;
const MONO =
  Platform.OS === "web"
    ? "ui-monospace, Menlo, monospace"
    : Platform.OS === "android"
      ? "monospace"
      : "Menlo";

function StatusIcon({ status, colors }: { status: SetupStatus; colors: Colors }) {
  if (status === "running") return <ActivityIndicator size="small" color={colors.accent} />;
  if (status === "completed") {
    return <Icon name="CheckCircle2" size={14} color={colors.statusSuccess} />;
  }
  return <Icon name="CircleAlert" size={14} color={colors.statusDanger} />;
}

function defaultCommandIndex(commands: readonly SetupCommand[]): number | null {
  const command =
    runningCommand(commands) ?? failedCommand(commands) ?? commands[commands.length - 1];
  return command?.index ?? null;
}

/** Popover body for the composer pill: overall status, each command, and one log. */
export function SetupPopover({
  theme,
  snapshot,
  runningSinceMs,
}: {
  theme: PluginTheme;
  snapshot: SetupSnapshot | null;
  runningSinceMs: number | null;
}) {
  const { colors } = theme;
  const [nowMs, setNowMs] = useState(() => Date.now());
  // null follows the running command; a press pins the log to that command.
  const [pinned, setPinned] = useState<number | null>(null);
  const logRef = useRef<ScrollView>(null);
  const running = snapshot?.status === "running";

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [running]);

  const commands = snapshot?.detail.commands ?? [];
  const selectedIndex =
    pinned !== null && commands.some((command) => command.index === pinned)
      ? pinned
      : defaultCommandIndex(commands);
  const selected = commands.find((command) => command.index === selectedIndex) ?? null;
  const overallLog = snapshot?.detail.log ?? "";
  const rawLog = selected
    ? selected.log.trim() || (selected.status === "running" ? overallLog : "")
    : overallLog;
  const log = processCarriageReturns(rawLog).trimEnd();

  useEffect(() => {
    logRef.current?.scrollToEnd({ animated: false });
  }, [log]);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!snapshot) {
    return (
      <View style={styles.waiting}>
        <ActivityIndicator size="small" color={colors.foregroundMuted} />
        <Text style={styles.muted}>Waiting for setup…</Text>
      </View>
    );
  }

  const elapsedMs = running && runningSinceMs ? Math.max(0, nowMs - runningSinceMs) : 0;
  const title = snapshot.status === "failed" ? "Setup failed" : headline(snapshot);
  const showError =
    snapshot.status === "failed" &&
    Boolean(snapshot.error?.trim()) &&
    (!selected || selected.status === "failed");

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.iconSlot}>
          <StatusIcon status={snapshot.status} colors={colors} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {snapshot.detail.branchName ? (
            <Text style={styles.muted} numberOfLines={1}>
              {snapshot.detail.branchName}
            </Text>
          ) : null}
        </View>
        {elapsedMs > 0 ? <Text style={styles.duration}>{formatDuration(elapsedMs)}</Text> : null}
      </View>

      {commands.length > 1 ? (
        <View style={styles.commands}>
          {commands.map((command) => {
            const isSelected = command.index === selectedIndex;
            const duration =
              typeof command.durationMs === "number"
                ? formatDuration(command.durationMs)
                : command.status === "running" && elapsedMs > 0
                  ? formatDuration(elapsedMs)
                  : null;
            return (
              <Pressable
                key={`${command.index}:${command.command}`}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`Show log for ${command.command}`}
                onPress={() => setPinned(command.index)}
                style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
                  styles.row,
                  isSelected || hovered || pressed ? styles.rowActive : null,
                ]}
              >
                <View style={styles.iconSlot}>
                  <StatusIcon status={command.status} colors={colors} />
                </View>
                <Text style={styles.command} numberOfLines={1}>
                  {command.command}
                </Text>
                {duration ? <Text style={styles.duration}>{duration}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ) : selected ? (
        <Text style={styles.singleCommand} numberOfLines={2}>
          {selected.command}
        </Text>
      ) : null}

      {showError ? (
        <Text style={styles.error} selectable>
          {snapshot.error}
        </Text>
      ) : null}

      {snapshot.status === "completed" && commands.length === 0 && !log ? (
        <Text style={styles.muted}>No setup commands ran in this worktree.</Text>
      ) : (
        <ScrollView ref={logRef} style={styles.logBox} contentContainerStyle={styles.logPad}>
          <Text style={log ? styles.log : styles.muted} selectable>
            {log || "No output yet."}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return {
    root: { gap: 12 } satisfies ViewStyle,
    waiting: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 4,
    } satisfies ViewStyle,
    header: { flexDirection: "row", alignItems: "center", gap: 8 } satisfies ViewStyle,
    headerText: { flex: 1, minWidth: 0, gap: 2 } satisfies ViewStyle,
    title: { color: colors.foreground, fontSize: 14, fontWeight: "600" } satisfies TextStyle,
    muted: { color: colors.foregroundMuted, fontSize: 12 } satisfies TextStyle,
    iconSlot: {
      width: 16,
      height: 16,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    } satisfies ViewStyle,
    commands: { gap: 2, marginHorizontal: -6 } satisfies ViewStyle,
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 28,
      paddingHorizontal: 6,
      borderRadius: 6,
    } satisfies ViewStyle,
    rowActive: { backgroundColor: colors.surface2 } satisfies ViewStyle,
    command: {
      flex: 1,
      minWidth: 0,
      color: colors.foreground,
      fontSize: 12,
      fontFamily: MONO,
    } satisfies TextStyle,
    singleCommand: {
      color: colors.foregroundMuted,
      fontSize: 12,
      lineHeight: 18,
      fontFamily: MONO,
    } satisfies TextStyle,
    duration: {
      color: colors.foregroundMuted,
      fontSize: 12,
      fontVariant: ["tabular-nums"],
      flexShrink: 0,
    } satisfies TextStyle,
    logBox: {
      height: LOG_HEIGHT,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface0,
    } satisfies ViewStyle,
    logPad: { paddingHorizontal: 10, paddingVertical: 8 } satisfies ViewStyle,
    log: {
      color: colors.foreground,
      fontSize: 12,
      lineHeight: 18,
      fontFamily: MONO,
    } satisfies TextStyle,
    error: { color: colors.statusDanger, fontSize: 12, lineHeight: 18 } satisfies TextStyle,
  };
}
