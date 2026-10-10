import { observeDirectory, type PaseoWorkspaceUpdate } from "./directory";
import {
  type PluginButtonContentProps,
  type PluginButtonIconProps,
  type PluginButtonRegistration,
  type PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useSyncExternalStore } from "react";
import { ActivityIndicator } from "react-native";
import type { SetupSnapshot } from "../shared/setup";
import { getSetupStatus } from "../shared/setup";
import {
  buttonLabel,
  completedDurationMs,
  shouldShowButton,
  statusIconName,
} from "../shared/snapshot";
import { SetupPopover } from "./popover";

export function contributeClient(client: PluginClientContext) {
  // One top-bar button per worktree: a new worktree has no agent (and so no
  // composer to hold a pill) until its first message, while setup is running.
  const buttons = new Map<string, { label: string; button: PluginButtonRegistration }>();
  const snapshots = new Map<string, SetupSnapshot | null>();
  const snapshotListeners = new Map<string, Set<() => void>>();
  const useSnapshot = (workspaceId: string) =>
    useSyncExternalStore(
      (listener) => {
        const listeners = snapshotListeners.get(workspaceId) ?? new Set<() => void>();
        listeners.add(listener);
        snapshotListeners.set(workspaceId, listeners);
        return () => {
          listeners.delete(listener);
          if (!listeners.size) snapshotListeners.delete(workspaceId);
        };
      },
      () => snapshots.get(workspaceId) ?? null,
    );
  function SetupIcon(props: PluginButtonIconProps) {
    const { theme, workspaceId, size, color } = props;
    const snapshot = useSnapshot(workspaceId);
    if (snapshot?.status === "running") {
      return <ActivityIndicator size={size} color={theme.colors.accent} />;
    }
    return (
      <Icon
        name={snapshot ? statusIconName(snapshot.status) : "Package"}
        size={size}
        color={
          snapshot?.status === "failed"
            ? theme.colors.statusDanger
            : snapshot?.status === "completed"
              ? theme.colors.statusSuccess
              : color
        }
      />
    );
  }

  function SetupContent({ theme, workspaceId, close }: PluginButtonContentProps) {
    const snapshot = useSnapshot(workspaceId);
    return (
      <SetupPopover
        theme={theme}
        snapshot={snapshot}
        runningSinceMs={runningSince.get(workspaceId) ?? null}
        onDismiss={() => {
          close();
          dismiss(workspaceId);
        }}
      />
    );
  }

  const runningSince = new Map<string, number>();
  const tookMs = new Map<string, number>();
  const sawRunning = new Set<string>();
  const dismissed = new Set<string>();
  let stopped = false;
  let dataTimer: ReturnType<typeof setTimeout> | undefined;
  const worktreeIds = new Set<string>();
  const pending = new Map<string, object>();
  let labelTimer: ReturnType<typeof setInterval> | undefined;

  const remove = (workspaceId: string) => {
    buttons.get(workspaceId)?.button.remove();
    buttons.delete(workspaceId);
  };

  const forgetWorkspace = (workspaceId: string) => {
    pending.delete(workspaceId);
    snapshots.delete(workspaceId);
    for (const listener of snapshotListeners.get(workspaceId) ?? []) listener();
    runningSince.delete(workspaceId);
    tookMs.delete(workspaceId);
    sawRunning.delete(workspaceId);
    dismissed.delete(workspaceId);
  };

  const dismiss = (workspaceId: string) => {
    dismissed.add(workspaceId);
    publishButtons();
  };

  const rememberSnapshot = (workspaceId: string, snapshot: SetupSnapshot | null) => {
    if (JSON.stringify(snapshots.get(workspaceId)) !== JSON.stringify(snapshot)) {
      snapshots.set(workspaceId, snapshot);
      for (const listener of snapshotListeners.get(workspaceId) ?? []) listener();
    }
    if (snapshot?.status === "running") {
      // A rerun shows again even after the last result was dismissed.
      if (!runningSince.has(workspaceId)) runningSince.set(workspaceId, Date.now());
      sawRunning.add(workspaceId);
      dismissed.delete(workspaceId);
      tookMs.delete(workspaceId);
    } else {
      const since = runningSince.get(workspaceId);
      if (since !== undefined) tookMs.set(workspaceId, Date.now() - since);
      runningSince.delete(workspaceId);
    }
  };

  const publishButtons = () => {
    if (stopped) return;
    const now = Date.now();
    for (const workspaceId of worktreeIds) {
      const snapshot = snapshots.get(workspaceId) ?? null;
      const seen = { sawRunning: sawRunning.has(workspaceId), dismissed: dismissed.has(workspaceId) };
      if (!shouldShowButton(snapshot, seen)) {
        remove(workspaceId);
        continue;
      }
      const since = runningSince.get(workspaceId);
      const elapsedMs =
        snapshot?.status === "running" && since
          ? Math.max(0, now - since)
          : completedDurationMs(snapshot?.detail.commands ?? []) || (tookMs.get(workspaceId) ?? 0);
      const label = buttonLabel(snapshot, elapsedMs) ?? "Setup";
      const current = buttons.get(workspaceId);
      if (!current) {
        const button = client.addHeaderButton({
          id: "setup-monitor",
          workspaceId,
          button: {
            title: "Worktree setup",
            icon: SetupIcon,
            label,
            behavior: { kind: "popover", Content: SetupContent },
          },
        });
        buttons.set(workspaceId, { label, button });
      } else if (current.label !== label) {
        current.button.update({ label });
        current.label = label;
      }
    }
    for (const workspaceId of buttons.keys()) {
      if (!worktreeIds.has(workspaceId)) remove(workspaceId);
    }
  };

  const refreshWorkspace = async (workspaceId: string) => {
    if (stopped || pending.has(workspaceId) || !worktreeIds.has(workspaceId)) return;
    const request = {};
    pending.set(workspaceId, request);
    try {
      const { snapshot } = await client.rpc(getSetupStatus, { workspaceId });
      if (stopped || !worktreeIds.has(workspaceId) || pending.get(workspaceId) !== request) return;
      rememberSnapshot(workspaceId, snapshot);
      publishButtons();
    } catch { /* Retry on the next status refresh. */ }
    finally { if (pending.get(workspaceId) === request) pending.delete(workspaceId); }
  };
  const sync = async () => {
    await Promise.all([...worktreeIds].map(refreshWorkspace));
    if (!stopped) dataTimer = setTimeout(() => void sync(), 2_000);
  };
  const unsubscribeWorkspaces = observeDirectory({
    list: (options) => client.paseo.workspaces.list(options),
    select: (message) => message.type === "workspace_update" ? message.payload : undefined,
    snapshot: (entries) => {
      const next = new Set(entries.filter((workspace) => workspace.workspaceKind === "worktree").map((workspace) => workspace.id));
      for (const id of worktreeIds) if (!next.has(id)) { worktreeIds.delete(id); forgetWorkspace(id); }
      for (const id of next) {
        worktreeIds.add(id);
        void refreshWorkspace(id);
      }
      publishButtons();
    },
    update: (update: PaseoWorkspaceUpdate) => {
      const id = update.kind === "remove" ? update.id : update.workspace.id;
      if (update.kind === "remove" || update.workspace.workspaceKind !== "worktree") {
        worktreeIds.delete(id);
        forgetWorkspace(id);
      } else if (!worktreeIds.has(id)) {
        worktreeIds.add(id);
        void refreshWorkspace(id);
      }
      publishButtons();
    },
  });
  labelTimer = setInterval(() => {
    publishButtons();
  }, 1_000);
  void sync();

  return () => {
    stopped = true;
    unsubscribeWorkspaces();
    if (dataTimer) clearTimeout(dataTimer);
    if (labelTimer) clearInterval(labelTimer);
    for (const { button } of buttons.values()) button.remove();
    buttons.clear();
  };
}
