import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { openExternalUrl, useWorkspace } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { useLinks, useLinkStatus } from "./links-query";
import { displayUrl, linkIcon, type WorkspaceLink } from "../shared/menu";
import type { LinkStatus } from "../shared/links";

type Colors = PluginButtonContentProps["theme"]["colors"];
type Styles = ReturnType<typeof makeStyles>;
type PressState = { hovered?: boolean; pressed: boolean };

const STATUS_LABEL: Record<LinkStatus, string> = { up: "running", down: "not responding" };

// Touch screens have no hover, so row actions stay visible there.
const ALWAYS_SHOW_ACTIONS = Platform.OS !== "web";

/** Popover body for the Links button: each link with its URL, and the way into the panel. */
export function LinksPopover({
  theme,
  host,
  workspaceId,
  close,
  onManage,
}: PluginButtonContentProps & { onManage(): void }) {
  const { colors } = theme;
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const query = useLinks(host.id, workspaceId, directory);
  const links = query.data?.links ?? [];
  const status = useLinkStatus(host.id, workspaceId, directory);
  // Statuses come back in file order; ignore a reply that predates an edit to the file.
  const statuses = status.data?.statuses.length === links.length ? status.data.statuses : [];
  const manage = () => {
    close();
    onManage();
  };

  let body: ReactNode;
  if (!query.data && !query.error && directory) {
    body = (
      <View style={styles.waiting}>
        <ActivityIndicator size={14} color={colors.foregroundMuted} />
        <Text style={styles.muted}>Loading links…</Text>
      </View>
    );
  } else if (query.error) {
    body = (
      <EmptyState
        styles={styles}
        colors={colors}
        icon="TriangleAlert"
        title="Couldn’t read links"
        detail="Check workspace-links.json in the Links panel."
        action="Open Links panel"
        onAction={manage}
      />
    );
  } else if (links.length === 0) {
    body = (
      <EmptyState
        styles={styles}
        colors={colors}
        icon="Link2"
        title="No links yet"
        detail="List your dev servers and dashboards in workspace-links.json to open them from here."
        action="Add links"
        onAction={manage}
      />
    );
  } else {
    body = (
      <View style={styles.list}>
        {links.map((link, index) => (
          <LinkRow
            key={`${index}:${link.url}`}
            link={link}
            status={statuses[index]}
            disabled={!directory}
            styles={styles}
            colors={colors}
            onOpen={() => {
              close();
              void openExternalUrl(link.url);
            }}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Links</Text>
        {links.length > 0 ? <Text style={styles.count}>{links.length}</Text> : null}
        <View style={styles.spacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage links"
          onPress={manage}
          style={({ hovered, pressed }: PressState) => [styles.iconButton, (hovered || pressed) && styles.iconButtonActive]}
        >
          <Icon name="Settings2" size={14} color={colors.foregroundMuted} />
        </Pressable>
      </View>
      {body}
    </View>
  );
}

function LinkRow({
  link,
  status,
  disabled,
  styles,
  colors,
  onOpen,
}: {
  link: WorkspaceLink;
  status: LinkStatus | undefined;
  disabled: boolean;
  styles: Styles;
  colors: Colors;
  onOpen(): void;
}) {
  const toast = useToast();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(id);
  }, [copied]);

  const showActions = ALWAYS_SHOW_ACTIONS || hovered || copied;

  // Hover lives on the row's container, the way Paseo's own rows do it: pointer enter and leave
  // ignore moves between children, so reaching for the copy button keeps the row lit.
  return (
    <View
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={[styles.row, (hovered || pressed) && styles.rowActive, disabled && styles.disabled]}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={[link.label, link.url, status && STATUS_LABEL[status]].filter(Boolean).join(", ")}
        disabled={disabled}
        onPress={onOpen}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={styles.rowMain}
      >
        <View style={styles.linkIcon}>
          <Icon name={linkIcon(link)} size={16} color={hovered ? colors.foreground : colors.foregroundMuted} />
        </View>
        <View style={styles.text}>
          <Text style={styles.label} numberOfLines={1}>{link.label}</Text>
          <View style={styles.urlLine}>
            <View style={[styles.dot, status === "up" && styles.dotUp, status === "down" && styles.dotDown]} />
            <Text style={[styles.url, status === "down" && styles.urlDown]} numberOfLines={1} ellipsizeMode="middle">
              {displayUrl(link.url)}
            </Text>
          </View>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copied ? `Copied ${link.label} URL` : `Copy ${link.label} URL`}
        onPress={() => {
          copyText(link.url).then(
            () => setCopied(true),
            () => toast.error("Couldn’t copy this URL."),
          );
        }}
        style={({ hovered: over, pressed: down }: PressState) => [
          styles.iconButton,
          (over || down) && styles.iconButtonOnRow,
          !showActions && styles.hidden,
        ]}
      >
        <Icon name={copied ? "Check" : "Copy"} size={14} color={copied ? colors.statusSuccess : colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}

function EmptyState({
  styles,
  colors,
  icon,
  title,
  detail,
  action,
  onAction,
}: {
  styles: Styles;
  colors: Colors;
  icon: string;
  title: string;
  detail: string;
  action: string;
  onAction(): void;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={16} color={colors.foregroundMuted} />
      </View>
      <View style={styles.emptyText}>
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.emptyDetail}>{detail}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onAction}
        style={({ hovered, pressed }: PressState) => [styles.primary, (hovered || pressed) && styles.primaryActive]}
      >
        <Text style={styles.primaryLabel}>{action}</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return {
    // The host pads the popover 12 on the sides and 16 top and bottom; even it out to 12.
    root: { gap: 6, marginVertical: -4 } satisfies ViewStyle,
    header: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 24 } satisfies ViewStyle,
    title: { color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600" } satisfies TextStyle,
    count: {
      color: colors.foregroundMuted,
      fontSize: 12,
      lineHeight: 18,
      fontVariant: ["tabular-nums"],
    } satisfies TextStyle,
    spacer: { flex: 1 } satisfies ViewStyle,
    iconButton: {
      width: 24,
      height: 24,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 6,
    } satisfies ViewStyle,
    iconButtonActive: { backgroundColor: colors.surface2 } satisfies ViewStyle,
    iconButtonOnRow: { backgroundColor: colors.surface1 } satisfies ViewStyle,
    waiting: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 } satisfies ViewStyle,
    muted: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 } satisfies TextStyle,
    // Rows bleed into the padding so their hover fill lines up with the header's edges.
    list: { marginHorizontal: -6 } satisfies ViewStyle,
    row: { flexDirection: "row", alignItems: "center", paddingRight: 6, borderRadius: 6 } satisfies ViewStyle,
    rowMain: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 6,
      paddingLeft: 6,
      paddingRight: 4,
    } satisfies ViewStyle,
    rowActive: { backgroundColor: colors.surface2 } satisfies ViewStyle,
    disabled: { opacity: 0.5 } satisfies ViewStyle,
    linkIcon: { width: 20, alignItems: "center", flexShrink: 0 } satisfies ViewStyle,
    text: { flex: 1, minWidth: 0 } satisfies ViewStyle,
    label: { color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "500" } satisfies TextStyle,
    urlLine: { flexDirection: "row", alignItems: "center", gap: 6 } satisfies ViewStyle,
    // Holds its place before the first check lands, so the URL never jumps sideways.
    dot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 } satisfies ViewStyle,
    dotUp: { backgroundColor: colors.statusSuccess } satisfies ViewStyle,
    dotDown: { borderWidth: 1, borderColor: colors.foregroundMuted } satisfies ViewStyle,
    url: { flexShrink: 1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 16 } satisfies TextStyle,
    urlDown: { opacity: 0.6 } satisfies TextStyle,
    hidden: { opacity: 0 } satisfies ViewStyle,
    empty: { alignItems: "center", gap: 10, paddingTop: 12, paddingBottom: 6 } satisfies ViewStyle,
    emptyIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface2,
    } satisfies ViewStyle,
    emptyText: { alignItems: "center", gap: 2, maxWidth: 260 } satisfies ViewStyle,
    emptyTitle: { color: colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600" } satisfies TextStyle,
    emptyDetail: {
      color: colors.foregroundMuted,
      fontSize: 12,
      lineHeight: 17,
      textAlign: "center",
    } satisfies TextStyle,
    primary: {
      height: 28,
      paddingHorizontal: 12,
      justifyContent: "center",
      borderRadius: 6,
      backgroundColor: colors.accent,
    } satisfies ViewStyle,
    primaryActive: { opacity: 0.9 } satisfies ViewStyle,
    primaryLabel: { color: colors.accentForeground, fontSize: 12, lineHeight: 16, fontWeight: "500" } satisfies TextStyle,
  };
}
