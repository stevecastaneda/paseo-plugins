import { Icon, type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { getLinks, openLink } from "./links.shared";
import { isShortcutEnabled, setShortcutEnabled } from "./pills.client";

export function LinksPanel(props: PluginWorkspacePanelProps) {
  return <WorkspaceLinks key={`${props.host.id}:${props.workspaceId}`} {...props} />;
}

function WorkspaceLinks({ theme, workspaceId, host }: PluginWorkspacePanelProps) {
  const fetchLinks = useRpc(getLinks);
  const launch = useRpc(openLink);
  const [showPill, setShowPill] = useState(() => isShortcutEnabled(workspaceId));
  const openingRef = useRef(false);
  const [opening, setOpening] = useState(false);
  const [exampleExpanded, setExampleExpanded] = useState(false);
  const [hoveredLink, setHoveredLink] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ configured: boolean; links: { label: string; url: string }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const colors = theme.colors;
  const isEmpty = result !== null && result.links.length === 0;

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
      <View style={{ paddingHorizontal: 12, paddingTop: isEmpty ? 20 : 12, paddingBottom: 16, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {isEmpty ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="Link" size={18} color={colors.foregroundMuted} />
            <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: "500" }}>Add your first link</Text>
          </View>
        ) : (
          <Text accessibilityRole="header" style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>Add links</Text>
        )}
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
      <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text accessibilityRole="header" style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, paddingHorizontal: 12, paddingTop: 12 }}>Options</Text>
        <Pressable accessibilityRole="switch" accessibilityLabel="Show link pill"
          accessibilityState={{ checked: showPill }}
          onPress={() => { setShortcutEnabled(workspaceId, !showPill); setShowPill(!showPill); }}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 40, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: pressed ? colors.surface1 : colors.surface0 })}>
          <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 18 }}>Show link pill</Text>
          <View style={{ width: 28, height: 16, borderRadius: 8, padding: 2, justifyContent: "center", alignItems: showPill ? "flex-end" : "flex-start", backgroundColor: showPill ? colors.accent : colors.surface2, borderWidth: showPill ? 0 : 1, borderColor: colors.border }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: showPill ? colors.accentForeground : colors.foregroundMuted }} />
          </View>
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 12, paddingBottom: 12 }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>Preview</Text>
          <View accessible accessibilityLabel="Link pill preview" style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Icon name="Link" size={14} color={colors.foregroundMuted} />
          </View>
        </View>
        <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, paddingHorizontal: 12, paddingBottom: 12 }}>
          This workspace · Resets when the plugin reloads
        </Text>
      </View>
    </ScrollView>
  );
}
