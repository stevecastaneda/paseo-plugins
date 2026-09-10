import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { getLinks, openLink } from "../shared/links";
import { getShortcutSettings, PLACEMENT_OPTIONS, updateShortcutSettings, type ShortcutSettings } from "../shared/shortcut";
import { getShortcut, setShortcut, subscribeShortcut } from "./pills";

function CompactSelect<Value extends string>({
  colors,
  label,
  value,
  options,
  onValueChange,
}: {
  colors: PluginWorkspacePanelProps["theme"]["colors"];
  label: string;
  value: Value;
  options: readonly { label: string; value: Value }[];
  onValueChange(value: Value): void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value)?.label ?? value;
  return (
    <View style={{ position: "relative", zIndex: open ? 10 : 0 }}>
      <View style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 32,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 4,
      }}>
        <Text style={{ flex: 1, color: colors.foreground, fontSize: 12, lineHeight: 18 }}>{label}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${selected}`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((current) => !current)}
          style={({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 6,
            paddingVertical: 4,
            borderRadius: 6,
            backgroundColor: hovered || open ? colors.surface1 : "transparent",
          })}
        >
          <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 18 }}>{selected}</Text>
          <Icon name="ChevronDown" size={14} color={colors.foregroundMuted} />
        </Pressable>
      </View>
      {open ? (
        <View style={{
          position: "absolute",
          right: 12,
          top: 32,
          minWidth: 168,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 6,
          overflow: "hidden",
          backgroundColor: colors.surface0,
        }}>
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  backgroundColor: pressed ? colors.surface1 : colors.surface0,
                })}
              >
                <Text style={{ flex: 1, color: colors.foreground, fontSize: 12, lineHeight: 18 }}>{option.label}</Text>
                {isSelected ? <Icon name="Check" size={14} color={colors.foreground} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export function LinksPanel(props: PluginWorkspacePanelProps) {
  return <WorkspaceLinks key={`${props.host.id}:${props.workspaceId}`} {...props} />;
}

function WorkspaceLinks({ theme, workspaceId, host }: PluginWorkspacePanelProps) {
  const fetchLinks = useRpc(getLinks);
  const launch = useRpc(openLink);
  const fetchShortcut = useRpc(getShortcutSettings);
  const saveShortcut = useRpc(updateShortcutSettings);
  const [shortcut, setLocalShortcut] = useState(getShortcut);
  const [shortcutLoaded, setShortcutLoaded] = useState(false);
  const [shortcutSaving, setShortcutSaving] = useState(false);
  const [shortcutLoadError, setShortcutLoadError] = useState<string | null>(null);
  const [shortcutSaveError, setShortcutSaveError] = useState<string | null>(null);
  const openingRef = useRef(false);
  const [opening, setOpening] = useState(false);
  const [exampleExpanded, setExampleExpanded] = useState(false);
  const [guideExpanded, setGuideExpanded] = useState(false);
  const [hoveredLink, setHoveredLink] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ configured: boolean; links: { label: string; url: string }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const colors = theme.colors;
  const isEmpty = result !== null && result.links.length === 0;

  useEffect(() => subscribeShortcut(() => setLocalShortcut(getShortcut())), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setResult(null);
    fetchLinks({ workspaceId }).then(
      (data) => { if (active) setResult(data); },
      (reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); },
    ).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchLinks, workspaceId, revision]);

  useEffect(() => {
    let active = true;
    setShortcutLoaded(false);
    setShortcutLoadError(null);
    setShortcutSaveError(null);
    fetchShortcut({}).then(
      (data) => {
        if (!active) return;
        setShortcut(data);
        setShortcutLoaded(true);
      },
      () => {
        if (!active) return;
        setShortcutLoadError("Could not load options. Try again.");
        setShortcutLoaded(true);
      },
    );
    return () => { active = false; };
  }, [fetchShortcut]);

  async function persistShortcut(patch: Partial<ShortcutSettings>) {
    if (!shortcutLoaded || shortcutSaving || shortcutLoadError) return;
    const previous = getShortcut();
    setShortcut(patch);
    setShortcutSaving(true);
    setShortcutSaveError(null);
    try {
      setShortcut(await saveShortcut(patch));
    } catch {
      setShortcut(previous);
      setShortcutSaveError("Could not save options. Your previous settings are still shown. Try the control again.");
    } finally {
      setShortcutSaving(false);
    }
  }

  async function openUrl(url: string) {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setError(null);
    try {
      await launch({ workspaceId, url });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open the host’s browser.");
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  }

  const setupGuide = (
    <View style={{ paddingHorizontal: 12, paddingTop: isEmpty ? 20 : 4, paddingBottom: 16, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {isEmpty ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="Link" size={18} color={colors.foregroundMuted} />
            <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: "500" }}>Add your first link</Text>
          </View>
        ) : null}
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
          {result?.configured ? "Add URLs to " : "Create "}<Text style={{ color: colors.foreground }}>workspace-links.json</Text> in the workspace root for your app, tools, or docs.
        </Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
          Edit it by hand or generate it during setup, then refresh.
        </Text>
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 6, overflow: "hidden" }}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: exampleExpanded }}
            onPress={() => setExampleExpanded((expanded) => !expanded)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: pressed ? colors.surface1 : colors.surface0 })}>
            <Icon name="Code" size={14} color={colors.foregroundMuted} />
            <Text style={{ flex: 1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>JSON example</Text>
            <Icon name={exampleExpanded ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} />
          </Pressable>
          {exampleExpanded ? (
            <ScrollView horizontal style={{ backgroundColor: colors.surface1, borderTopWidth: 1, borderTopColor: colors.border }}
              contentContainerStyle={{ padding: 10 }}>
              <Text selectable accessibilityLabel="Example workspace-links.json" style={{ color: colors.foreground, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, lineHeight: 18 }}>
                {`[
  {
    "label": "App",
    "url": "http://localhost:3000"
  }
]`}
              </Text>
            </ScrollView>
          ) : null}
        </View>
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface0 }}
      contentContainerStyle={{ paddingBottom: 16 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 12, paddingRight: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text accessibilityRole="header" style={{ flex: 1, color: colors.foregroundMuted, fontSize: 13, lineHeight: 18 }}>
          Workspace Links
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh links"
          accessibilityState={{ disabled: loading }} disabled={loading}
          hitSlop={8} onPress={() => setRevision((value) => value + 1)}
          style={({ pressed }) => ({ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: pressed ? colors.surface1 : colors.surface0, opacity: loading ? 0.5 : 1 })}>
          <Icon name="RefreshCw" size={14} color={colors.foregroundMuted} />
        </Pressable>
      </View>
      {loading ? <ActivityIndicator color={colors.foregroundMuted} accessibilityLabel="Loading links" style={{ padding: 12 }} /> : null}
      {error ? (
        <Text accessibilityRole="alert" selectable style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 18, padding: 12 }}>{error}</Text>
      ) : null}
      {result?.links.map((link, index) => (
        <Pressable key={index} accessibilityRole="link" accessibilityLabel={`Open ${link.label} on ${host.label}`}
          disabled={opening} accessibilityState={{ disabled: opening }}
          onHoverIn={() => setHoveredLink(index)} onHoverOut={() => setHoveredLink(null)}
          onPress={() => void openUrl(link.url)}
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "center", gap: 12, minHeight: 40,
            paddingHorizontal: 12, paddingVertical: 10,
            borderBottomWidth: 1, borderBottomColor: colors.border,
            backgroundColor: pressed || hoveredLink === index ? colors.surface1 : colors.surface0, opacity: opening ? 0.6 : 1,
          })}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{link.label}</Text>
            <Text selectable numberOfLines={1} ellipsizeMode="middle" accessibilityLabel={link.url} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{link.url}</Text>
          </View>
          <Icon name="ExternalLink" size={14} color={colors.foregroundMuted} />
        </Pressable>
      ))}
      {opening ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, padding: 12 }}>
          Opening browser on {host.label}…
        </Text>
      ) : null}
      {isEmpty ? setupGuide : null}
      <View style={{ zIndex: 1, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8 }}>
        <Text accessibilityRole="header" style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2 }}>
          Options
        </Text>
        {!shortcutLoaded ? <ActivityIndicator color={colors.foregroundMuted} accessibilityLabel="Loading options" style={{ padding: 12 }} /> : null}
        {shortcutLoadError ? (
          <View style={{ gap: 8, paddingHorizontal: 12, paddingBottom: 8 }}>
            <Text accessibilityRole="alert" style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 18 }}>
              {shortcutLoadError}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => {
              setShortcutLoaded(false);
              setShortcutLoadError(null);
              fetchShortcut({}).then(
                (data) => {
                  setShortcut(data);
                  setShortcutLoaded(true);
                },
                () => {
                  setShortcutLoadError("Could not load options. Try again.");
                  setShortcutLoaded(true);
                },
              );
            }}>
              <Text style={{ color: colors.accent, fontSize: 12, lineHeight: 18 }}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {shortcutLoaded && !shortcutLoadError ? (
          <View style={{ opacity: shortcutSaving ? 0.6 : 1 }}>
        <CompactSelect
          colors={colors}
          label="Show as"
          value={shortcut.placement}
          options={PLACEMENT_OPTIONS}
          onValueChange={(placement) => { void persistShortcut({ placement }); }}
        />
        {shortcut.placement === "header" ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Show label"
            accessibilityState={{ checked: shortcut.headerShowsLabel, disabled: shortcutSaving }}
            disabled={shortcutSaving}
            onPress={() => { void persistShortcut({ headerShowsLabel: !shortcut.headerShowsLabel }); }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              minHeight: 28,
              paddingHorizontal: 12,
              paddingTop: 4,
              paddingBottom: 8,
            }}
          >
            <Text style={{ flex: 1, color: colors.foreground, fontSize: 12, lineHeight: 18 }}>Show label</Text>
            <View style={{
              width: 28,
              height: 16,
              borderRadius: 8,
              padding: 2,
              justifyContent: "center",
              alignItems: shortcut.headerShowsLabel ? "flex-end" : "flex-start",
              backgroundColor: shortcut.headerShowsLabel ? colors.accent : colors.surface2,
              borderWidth: shortcut.headerShowsLabel ? 0 : 1,
              borderColor: colors.border,
            }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: shortcut.headerShowsLabel ? colors.accentForeground : colors.foregroundMuted }} />
            </View>
          </Pressable>
        ) : null}
          </View>
        ) : null}
        {shortcutSaveError ? (
          <Text accessibilityRole="alert" style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 18, paddingHorizontal: 12, paddingBottom: 8 }}>
            {shortcutSaveError}
          </Text>
        ) : null}
      </View>
      <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 12, paddingVertical: 10 }}>
        <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
          {shortcutSaving ? "Saving..." : `All workspaces on ${host.label} · Auto-save`}
        </Text>
      </View>
      {result && !isEmpty ? (
        <View>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: guideExpanded }}
            onPress={() => setGuideExpanded((expanded) => !expanded)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, backgroundColor: pressed ? colors.surface1 : colors.surface0 })}>
            <Text style={{ flex: 1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>Setup guide</Text>
            <Icon name={guideExpanded ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} />
          </Pressable>
          {guideExpanded ? setupGuide : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
