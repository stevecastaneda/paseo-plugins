import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { IconSwap, PressScale } from "./motion";
import { PressableRow } from "./row";
import { raised } from "./surfaces";
import { checkSetupFolder, listSetupFolders, saveSetup, type HideChoice } from "../shared/rpc";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

type Option<T extends string> = { value: T; label: string; detail: string };

const PLACES: Option<"outside" | "folder">[] = [
  { value: "outside", label: "Outside the repo", detail: "In a folder on this computer. Git never sees them." },
  { value: "folder", label: "In a folder in the repo", detail: "Next to your code, in a folder you name." },
];

const HIDES: Option<HideChoice>[] = [
  { value: "computer", label: "On this computer only", detail: "Adds rules to git's local exclude file. Nothing in the repo changes." },
  { value: "repo", label: "For everyone", detail: "Adds rules to the repo's .gitignore. Commit it to share it with your team." },
  { value: "none", label: "Don't hide them", detail: "Git sees the files, so they can be committed." },
];

// Asked once per repo, before the command will record anything. Every
// worktree of the repo uses the answer. Nothing is written until Save.
export function SetupCard({ colors, workspaceId, directory, hasRun }: {
  colors: Colors;
  workspaceId: string;
  directory: string;
  // A run from before setup existed is in .scratch; saving moves it.
  hasRun: boolean;
}) {
  const [place, setPlace] = useState<"outside" | "folder">("outside");
  const [folder, setFolder] = useState(".scratch");
  const [hide, setHide] = useState<HideChoice>("computer");
  const [picking, setPicking] = useState(false);
  const check = useRpc(checkSetupFolder);
  const save = useRpc(saveSetup);
  const queryClient = useQueryClient();
  const toast = useToast();
  const checked = useQuery({
    queryKey: ["progress", "setup-check", workspaceId, directory, folder],
    queryFn: () => check({ workspaceId, workspaceDirectory: directory, folder }),
    enabled: place === "folder",
  });
  const current = checked.data;
  const mutation = useMutation({
    mutationFn: () => save({
      workspaceId, workspaceDirectory: directory,
      choice: place === "outside" ? { kind: "outside" } : { kind: "folder", folder, hide: current?.alreadyIgnored ? "none" : hide },
    }),
    onSuccess: ({ shown }) => {
      queryClient.invalidateQueries({ queryKey: ["progress"] });
      toast.show(`The Progress plugin now keeps this repo's files in ${shown}.`, { variant: "success" });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save the setup."),
  });
  const ready = place === "outside" || Boolean(current && !current.error);

  return (
    <View style={{ margin: 12, padding: 12, gap: 12, borderRadius: 12, ...raised(colors), backgroundColor: colors.surface0 }}>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="FolderCog" size={16} color={colors.foregroundMuted} />
          <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: "500" }}>Set up the Progress plugin for this repo</Text>
        </View>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
          {hasRun
            ? "This worktree has a Progress run saved in .scratch from before setup existed. Choose where the plugin keeps this repo's files, and the run moves there."
            : "Agents can't record to the Progress dashboard here until you choose where the plugin keeps its files. You choose once; every worktree of this repo uses it."}
        </Text>
      </View>

      <Choices colors={colors} title="Where should the Progress plugin keep its files?" options={PLACES} value={place} onChange={(next) => setPlace(next)} />

      {/* The folder steps belong to "In a folder in the repo", so they sit on its text edge. */}
      {place === "folder" ? (
      <View style={{ gap: 12, paddingStart: 22 }}>
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>Folder</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingStart: 8, paddingEnd: 4, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.surface1 }}>
            <Icon name="Folder" size={14} color={colors.foregroundMuted} />
            <Text selectable numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1, color: colors.foreground, fontSize: 12, lineHeight: 16 }}>{folder}</Text>
            <PressScale accessibilityRole="button" onPress={() => setPicking(true)}
              style={({ pressed, hovered }) => ({ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, backgroundColor: pressed ? colors.border : hovered ? colors.surface2 : "transparent" })}>
              <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>Choose…</Text>
            </PressScale>
          </View>
          {current?.error ? <Text accessibilityRole="alert" style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 17 }}>{current.error}</Text> : null}
          <FolderPicker key={picking ? "open" : "closed"} colors={colors} workspaceId={workspaceId} directory={directory} open={picking} start={folder}
            onClose={() => setPicking(false)} onPick={(picked) => { setFolder(picked); setPicking(false); }} />
        </View>
        {current && !current.error ? (
          current.alreadyIgnored
            ? <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>Git already ignores the Progress plugin's files in that folder.</Text>
            : <Choices colors={colors} title="Keep them out of git?" options={HIDES} value={hide} onChange={(next) => setHide(next)} />
        ) : null}
      </View>
      ) : null}

      <PressScale accessibilityRole="button" disabled={!ready || mutation.isPending} onPress={() => mutation.mutate()}
        style={({ pressed, hovered }) => ({ alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.accent,
          opacity: !ready ? 0.5 : pressed || mutation.isPending ? 0.7 : hovered ? 0.85 : 1 })}>
        <Text style={{ color: colors.accentForeground, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>{mutation.isPending ? "Saving…" : "Save setup"}</Text>
      </PressScale>
    </View>
  );
}

function Choices<T extends string>({ colors, title, options, value, onChange }: {
  colors: Colors;
  title: string;
  options: Option<T>[];
  value: T;
  onChange(value: T): void;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={title} style={{ gap: 2 }}>
      <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 16, fontWeight: "600", marginBottom: 4 }}>{title}</Text>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <PressableRow key={option.value} colors={colors} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => onChange(option.value)}
            style={{ flexDirection: "row", gap: 8, paddingHorizontal: 6, paddingVertical: 6, marginHorizontal: -6, borderRadius: 6 }}>
            <View style={{ paddingTop: 2 }}>
              <IconSwap swapKey={selected ? "on" : "off"} size={14}>
                <Icon name={selected ? "CircleDot" : "Circle"} size={14} color={selected ? colors.accent : colors.foregroundMuted} />
              </IconSwap>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 18 }}>{option.label}</Text>
              <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{option.detail}</Text>
            </View>
          </PressableRow>
        );
      })}
    </View>
  );
}

// Browses the repo's folders on the daemon host. A new folder only needs a
// name: it's made the first time progress is recorded.
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
  const list = useRpc(listSetupFolders);
  const listed = useQuery({
    queryKey: ["progress", "setup-folders", workspaceId, directory, at],
    queryFn: () => list({ workspaceId, workspaceDirectory: directory, folder: at }),
    enabled: open,
  });
  const join = (name: string) => (at ? `${at}/${name}` : name);
  const crumbs = at ? at.split("/") : [];
  const close = () => { setNaming(null); setAt(parentOf(start)); onClose(); };
  const newName = naming?.trim().replace(/\/+$/, "") ?? "";

  return (
    <Modal title="Choose a folder" icon={<Icon name="FolderOpen" size={16} color={colors.foregroundMuted} />} open={open} onOpenChange={(next) => { if (!next) close(); }}>
      {/* Paseo sizes a non-scrolling dialog to 85% of the window, so let it size to
          its content; the list's own height cap keeps the buttons in view. */}
      <Modal.Content>
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
              autoCapitalize="none" autoCorrect={false} spellCheck={false} accessibilityLabel="New folder name" placeholder="progress" placeholderTextColor={colors.foregroundMuted}
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
