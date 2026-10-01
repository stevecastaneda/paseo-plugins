import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { PressScale } from "./motion";
import { PressableRow } from "./row";
import { listFolders, setHistoryFolder } from "../shared/rpc";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// Run history stays on this computer unless the repo opts in. This quiet row
// is the only place that changes it; nothing in the repo changes until then.
export function HistoryRow({ colors, workspaceId, directory, savedTo }: {
  colors: Colors;
  workspaceId: string;
  directory: string;
  savedTo: string | null;
}) {
  const [picking, setPicking] = useState(false);
  const set = useRpc(setHistoryFolder);
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (folder: string | null) => set({ workspaceId, workspaceDirectory: directory, folder }),
    onSuccess: ({ savedTo: next }) => {
      queryClient.invalidateQueries({ queryKey: ["progress", "dashboard"] });
      toast.show(next ? `Each run will be saved to ${next}.` : "Runs will stay on this computer. Files already saved stay in the repo.", { variant: "success" });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not change where runs are saved."),
  });
  // While saving, the button that started it says so.
  const busy = mutation.isPending ? (mutation.variables === null ? "stop" : "pick") : null;
  const actions: { label: string; busyLabel: string; kind: "pick" | "stop"; onPress(): void }[] = savedTo
    ? [{ label: "Change…", busyLabel: "Saving…", kind: "pick", onPress: () => setPicking(true) }, { label: "Stop saving", busyLabel: "Stopping…", kind: "stop", onPress: () => mutation.mutate(null) }]
    : [{ label: "Save to repo…", busyLabel: "Saving…", kind: "pick", onPress: () => setPicking(true) }];

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 4, marginHorizontal: 12, marginTop: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, flex: 1, minWidth: 180 }}>
        <View style={{ paddingTop: 2 }}><Icon name="History" size={13} color={colors.foregroundMuted} /></View>
        <Text style={{ flex: 1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          {savedTo ? <>Each run is saved to <Text style={{ color: colors.foreground }}>{savedTo}</Text> in this repo.</> : "Run history stays on this computer."}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {actions.map((action) => (
          <PressScale key={action.label} accessibilityRole="button" disabled={mutation.isPending} onPress={action.onPress}
            style={({ pressed, hovered }) => ({ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, opacity: mutation.isPending ? 0.7 : 1,
              backgroundColor: pressed ? colors.border : hovered ? colors.surface2 : "transparent" })}>
            <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>{busy === action.kind ? action.busyLabel : action.label}</Text>
          </PressScale>
        ))}
      </View>
      <FolderPicker key={picking ? "open" : "closed"} colors={colors} workspaceId={workspaceId} directory={directory} open={picking} start={savedTo ?? ""}
        onClose={() => setPicking(false)} onPick={(folder) => { setPicking(false); mutation.mutate(folder); }} />
    </View>
  );
}

// Browses the repo's folders on the daemon host. A new folder only needs a
// name: it's made the first time a run is saved there.
function FolderPicker({ colors, workspaceId, directory, open, start, onClose, onPick }: {
  colors: Colors;
  workspaceId: string;
  directory: string;
  open: boolean;
  // The folder chosen so far; browsing starts in the folder that holds it.
  start: string;
  onClose(): void;
  onPick(folder: string): void;
}) {
  const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");
  const [at, setAt] = useState(() => parentOf(start));
  const [naming, setNaming] = useState<string | null>(null);
  const list = useRpc(listFolders);
  const listed = useQuery({
    queryKey: ["progress", "folders", workspaceId, directory, at],
    queryFn: () => list({ workspaceId, workspaceDirectory: directory, folder: at }),
    enabled: open,
  });
  const join = (name: string) => (at ? `${at}/${name}` : name);
  const crumbs = at ? at.split("/") : [];
  const close = () => { setNaming(null); setAt(parentOf(start)); onClose(); };
  const newName = naming?.trim().replace(/\/+$/, "") ?? "";

  return (
    <Modal title="Save run history to a folder" icon={<Icon name="FolderOpen" size={16} color={colors.foregroundMuted} />} open={open} onOpenChange={(next) => { if (!next) close(); }}>
      {/* Paseo sizes a non-scrolling dialog to 85% of the window, so let it size to
          its content; the list's own height cap keeps the buttons in view. */}
      <Modal.Content>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          Each run becomes its own file in this folder, in every worktree of this repo. Commit them like any other file.
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 2, paddingHorizontal: 4 }}>
          {["Top of the repo", ...crumbs].map((crumb, index) => (
            <React.Fragment key={index}>
              {index ? <Icon name="ChevronRight" size={12} color={colors.foregroundMuted} /> : null}
              <PressScale accessibilityRole="button" disabled={index === crumbs.length} onPress={() => { setNaming(null); setAt(crumbs.slice(0, index).join("/")); }}
                style={({ pressed, hovered }) => ({ paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4,
                  backgroundColor: index === crumbs.length ? "transparent" : pressed ? colors.border : hovered ? colors.surface2 : "transparent" })}>
                <Text style={{ color: index === crumbs.length ? colors.foreground : colors.foregroundMuted, fontSize: 12, lineHeight: 16, fontWeight: index === crumbs.length ? "600" : "400" }}>{crumb}</Text>
              </PressScale>
            </React.Fragment>
          ))}
        </View>

        {/* Only the list scrolls, so Use and Cancel stay in view in a big repo. */}
        <ScrollView style={{ maxHeight: 320, flexGrow: 0 }} contentContainerStyle={{ gap: 2 }}>
          {listed.isPending ? <ActivityIndicator color={colors.foregroundMuted} accessibilityLabel="Loading folders" style={{ alignSelf: "flex-start", padding: 8 }} /> : null}
          {listed.data?.folders.map((name) => (
            <PressableRow key={name} colors={colors} accessibilityRole="button" accessibilityLabel={`Open ${name}`} onPress={() => { setNaming(null); setAt(join(name)); }}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6 }}>
              <Icon name="Folder" size={14} color={colors.foregroundMuted} />
              <Text numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1, color: colors.foreground, fontSize: 12, lineHeight: 16 }}>{name}</Text>
              <Icon name="ChevronRight" size={14} color={colors.foregroundMuted} />
            </PressableRow>
          ))}
          {listed.data && !listed.data.folders.length ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 16, paddingHorizontal: 8, paddingVertical: 6 }}>No folders in here.</Text>
          ) : null}
          {listed.error ? <Text accessibilityRole="alert" style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 17, paddingHorizontal: 8 }}>{listed.error.message}</Text> : null}
        </ScrollView>

        {naming === null ? (
          <PressScale accessibilityRole="button" onPress={() => setNaming("")}
            style={({ pressed, hovered }) => ({ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, backgroundColor: pressed ? colors.border : hovered ? colors.surface2 : "transparent" })}>
            <Icon name="FolderPlus" size={14} color={colors.foreground} />
            <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>New folder</Text>
          </PressScale>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <TextInput autoFocus value={naming} onChangeText={setNaming} onSubmitEditing={() => { if (newName) onPick(join(newName)); }}
              autoCapitalize="none" autoCorrect={false} spellCheck={false} accessibilityLabel="New folder name" placeholder="progress-history" placeholderTextColor={colors.foregroundMuted}
              style={{ flex: 1, color: colors.foreground, fontSize: 12, lineHeight: 16, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }} />
            <PressScale accessibilityRole="button" disabled={!newName} onPress={() => onPick(join(newName))}
              style={({ pressed, hovered }) => ({ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.accent, opacity: !newName ? 0.5 : pressed ? 0.7 : hovered ? 0.85 : 1 })}>
              <Text style={{ color: colors.accentForeground, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>Use new folder</Text>
            </PressScale>
          </View>
        )}

        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          {at ? null : <Text style={{ flex: 1, minWidth: 140, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>Open a folder to use it, or make a new one.</Text>}
          <PressScale accessibilityRole="button" onPress={close}
            style={({ pressed, hovered }) => ({ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: pressed ? colors.border : hovered ? colors.surface2 : "transparent" })}>
            <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>Cancel</Text>
          </PressScale>
          <PressScale accessibilityRole="button" disabled={!at} onPress={() => onPick(at)} outerStyle={{ flexShrink: 1 }}
            style={({ pressed, hovered }) => ({ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.accent, opacity: !at ? 0.5 : pressed ? 0.7 : hovered ? 0.85 : 1 })}>
            <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: colors.accentForeground, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>{at ? `Use ${crumbs[crumbs.length - 1]}` : "Use folder"}</Text>
          </PressScale>
        </View>
      </Modal.Content>
    </Modal>
  );
}
