import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import React, { useEffect, useState } from "react";
import { Text } from "react-native";
import { stopRun } from "../shared/rpc";
import { IconSwap, PressScale } from "./motion";
import { raised } from "./surfaces";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// How long "Stop run?" waits for the second press before backing off.
const CONFIRM_MS = 4_000;
// How long Playwright gets to wind down before the button offers to force it.
const FORCE_AFTER_MS = 8_000;

type Phase = "idle" | "confirm" | "stopping" | "force";

// Stops the run as Ctrl+C would. The first press asks, so a stray click
// can't end a long suite; if the run hasn't ended a while after stopping, the
// button offers to force it, as a second Ctrl+C does.
export function StopButton({ colors, runId, workspaceId, workspaceDirectory }: { colors: Colors; runId: string; workspaceId: string; workspaceDirectory: string }) {
  const stop = useRpc(stopRun);
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    if (phase !== "confirm" && phase !== "stopping") return;
    const id = setTimeout(() => setPhase(phase === "confirm" ? "idle" : "force"), phase === "confirm" ? CONFIRM_MS : FORCE_AFTER_MS);
    return () => clearTimeout(id);
  }, [phase]);

  const send = (next: Phase) => {
    setPhase(next);
    stop({ workspaceId, workspaceDirectory, runId }).catch((error: unknown) => {
      setPhase("idle");
      toast.error(error instanceof Error ? error.message : "Could not stop the run.");
    });
  };
  const onPress = () => {
    if (phase === "idle") setPhase("confirm");
    else if (phase === "confirm") send("stopping");
    else if (phase === "force") send("stopping");
  };

  const asking = phase === "confirm" || phase === "force";
  const label = phase === "confirm" ? "Stop run?" : phase === "stopping" ? "Stopping…" : phase === "force" ? "Force stop" : "Stop";
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={phase === "idle" ? "Stop the test run" : label}
      accessibilityState={{ busy: phase === "stopping" }} disabled={phase === "stopping"} onPress={onPress}
      style={({ pressed, hovered }) => ({
        flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4, paddingStart: 7, paddingEnd: 9, borderRadius: 4,
        ...(asking ? {} : raised(colors)),
        backgroundColor: asking ? colors.statusDanger : pressed ? colors.surface2 : hovered ? colors.surface2 : colors.surface1,
        opacity: phase === "stopping" ? 0.6 : asking && (pressed || hovered) ? 0.88 : 1,
      })}>
      <IconSwap swapKey={asking ? "ask" : phase} size={12}>
        <Icon name={phase === "stopping" ? "Hourglass" : "Square"} size={12} color={asking ? "#ffffff" : colors.foreground} />
      </IconSwap>
      <Text style={{ color: asking ? "#ffffff" : colors.foreground, fontSize: 12, lineHeight: 16, fontWeight: asking ? "600" : "400" }}>{label}</Text>
    </PressScale>
  );
}
