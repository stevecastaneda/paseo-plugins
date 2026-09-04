import { Icon, type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { SetupCommand, SetupStatus } from "./setup.shared";
import { getSetupStatus } from "./setup.shared";
import { formatDuration, processCarriageReturns, runningCommand } from "./snapshot";

function CommandStatusIcon({
  status,
  colors,
}: {
  status: SetupStatus;
  colors: PluginWorkspacePanelProps["theme"]["colors"];
}) {
  if (status === "running") {
    return <ActivityIndicator size="small" color={colors.foreground} />;
  }
  if (status === "completed") {
    return <Icon name="CheckCircle2" size={14} color={colors.statusSuccess} />;
  }
  return <Icon name="CircleAlert" size={14} color={colors.statusDanger} />;
}

function commandLog(command: SetupCommand, fallback: string): string {
  if (command.log.trim()) return command.log;
  if (command.status === "running") return fallback;
  return "";
}

export function SetupPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const fetchStatus = useRpc(getSetupStatus);
  const query = useQuery({
    queryKey: ["setup-monitor", "status", workspaceId],
    queryFn: () => fetchStatus({ workspaceId }),
    refetchInterval: (current) =>
      current.state.data?.snapshot?.status === "running" ? 750 : 4_000,
  });
  const snapshot = query.data?.snapshot ?? null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [runningSinceMs, setRunningSinceMs] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [collapsedAuto, setCollapsedAuto] = useState<Set<number>>(new Set());
  const logRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (snapshot?.status !== "running") {
      setRunningSinceMs(null);
      return;
    }
    setRunningSinceMs((current) => current ?? Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [snapshot?.status]);

  const commands = snapshot?.detail.commands ?? [];
  const autoExpandIndex = useMemo(() => {
    const running = runningCommand(commands);
    if (running) return running.index;
    return commands[commands.length - 1]?.index ?? null;
  }, [commands]);

  useEffect(() => {
    logRef.current?.scrollToEnd({ animated: false });
  }, [snapshot?.detail.log, snapshot?.detail.commands]);

  const toggle = useCallback(
    (index: number, isAuto: boolean) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(index) || isAuto) {
          next.delete(index);
          if (isAuto) {
            setCollapsedAuto((collapsed) => new Set(collapsed).add(index));
          }
        } else {
          next.add(index);
          setCollapsedAuto((collapsed) => {
            const updated = new Set(collapsed);
            updated.delete(index);
            return updated;
          });
        }
        return next;
      });
    },
    [],
  );

  const styles = useMemo(() => {
    return {
      screen: {
        flex: 1,
        minHeight: 0,
        backgroundColor: theme.colors.surface0,
      } satisfies ViewStyle,
      waiting: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 16,
      } satisfies ViewStyle,
      waitingText: {
        color: theme.colors.foregroundMuted,
        fontSize: 14,
      } satisfies TextStyle,
      branch: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      } satisfies TextStyle,
      block: {
        flexShrink: 0,
      } satisfies ViewStyle,
      blockOpen: {
        flex: 1,
        minHeight: 0,
      } satisfies ViewStyle,
      row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: theme.colors.surface1,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      } satisfies ViewStyle,
      iconSlot: {
        width: 18,
        height: 18,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      } satisfies ViewStyle,
      command: {
        flex: 1,
        color: theme.colors.foreground,
        fontSize: 14,
      } satisfies TextStyle,
      duration: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        flexShrink: 0,
      } satisfies TextStyle,
      chevron: { flexShrink: 0 } satisfies ViewStyle,
      chevronOpen: { transform: [{ rotate: "90deg" }] } satisfies ViewStyle,
      detail: {
        flex: 1,
        minHeight: 0,
        backgroundColor: theme.colors.surface0,
      } satisfies ViewStyle,
      logScroll: {
        flex: 1,
        minHeight: 0,
      } satisfies ViewStyle,
      logPad: {
        paddingHorizontal: 12,
        paddingVertical: 10,
      } satisfies ViewStyle,
      log: {
        color: theme.colors.foreground,
        fontSize: 12,
        lineHeight: 20,
        fontFamily: "Menlo",
      } satisfies TextStyle,
      emptyLog: {
        color: theme.colors.foregroundMuted,
        fontSize: 14,
        paddingHorizontal: 12,
        paddingVertical: 16,
      } satisfies TextStyle,
      errorCard: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      } satisfies ViewStyle,
      error: { color: theme.colors.statusDanger, fontSize: 14 } satisfies TextStyle,
    };
  }, [theme]);

  if (!snapshot || (snapshot.status === "running" && commands.length === 0)) {
    return (
      <View style={styles.screen}>
        <View style={styles.waiting}>
          <ActivityIndicator size="large" color={theme.colors.foregroundMuted} />
          <Text style={styles.waitingText}>
            {query.data?.error ?? "Waiting for setup..."}
          </Text>
        </View>
      </View>
    );
  }

  const elapsedMs =
    snapshot.status === "running" && runningSinceMs ? Math.max(0, nowMs - runningSinceMs) : 0;
  const overallLog = snapshot.detail.log;
  const noCommands =
    snapshot.status === "completed" && commands.length === 0 && overallLog.trim().length === 0;

  return (
    <View style={styles.screen}>
      {snapshot.detail.branchName ? (
        <Text style={styles.branch} numberOfLines={1}>
          {snapshot.detail.branchName}
        </Text>
      ) : null}

      {noCommands ? (
        <Text style={styles.emptyLog}>No setup commands ran in this worktree.</Text>
      ) : null}

      {commands.map((command) => {
        const isAuto =
          command.index === autoExpandIndex && !collapsedAuto.has(command.index);
        const showDetail = expanded.has(command.index) || isAuto;
        const rawLog = commandLog(command, overallLog);
        const hasLog = rawLog.trim().length > 0;
        const hasError = command.status === "failed" && Boolean(snapshot.error);
        const duration =
          typeof command.durationMs === "number"
            ? formatDuration(command.durationMs)
            : command.status === "running" && elapsedMs > 0
              ? formatDuration(elapsedMs)
              : null;
        return (
          <View
            key={`${command.index}:${command.command}`}
            style={showDetail ? styles.blockOpen : styles.block}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showDetail }}
              onPress={() => toggle(command.index, isAuto)}
              style={({ pressed }) => [styles.row, pressed ? { opacity: 0.8 } : null]}
            >
              <View style={styles.iconSlot}>
                <CommandStatusIcon status={command.status} colors={theme.colors} />
              </View>
              <Text style={styles.command} numberOfLines={1}>
                {command.command}
              </Text>
              {duration ? <Text style={styles.duration}>{duration}</Text> : null}
              <View style={showDetail ? styles.chevronOpen : styles.chevron}>
                <Icon name="ChevronRight" size={14} color={theme.colors.foregroundMuted} />
              </View>
            </Pressable>
            {showDetail ? (
              <View style={styles.detail}>
                <ScrollView
                  ref={command.status === "running" ? logRef : undefined}
                  style={styles.logScroll}
                  contentContainerStyle={styles.logPad}
                >
                  <Text style={hasLog ? styles.log : styles.emptyLog} selectable>
                    {hasLog ? processCarriageReturns(rawLog).trimEnd() : "No output yet."}
                  </Text>
                </ScrollView>
                {hasError && snapshot.error ? (
                  <View style={styles.errorCard}>
                    <Text style={styles.error} selectable>
                      {snapshot.error}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}

      {commands.length === 0 && overallLog.trim() ? (
        <ScrollView style={styles.logScroll} contentContainerStyle={styles.logPad}>
          <Text style={styles.log} selectable>
            {processCarriageReturns(overallLog).trimEnd()}
          </Text>
        </ScrollView>
      ) : null}

      {snapshot.error && !commands.some((command) => command.status === "failed") ? (
        <View style={styles.errorCard}>
          <Text style={styles.error} selectable>
            {snapshot.error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
