import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { Platform, Text, View } from "react-native";
import { previewKind } from "../shared/attachments";
import { previewDeliverable } from "../shared/rpc";
import { type Block, parseWriteUp, type Span, withoutTitle, writeUpExcerpt } from "../shared/write-up";
import { type Attachment, attachmentIcon } from "./attachments";
import { PressableRow } from "./row";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";

// What the ticket is: the start of its write-up in a quiet inset, with the
// rest a press away. A link or a file that isn't text shows only its name.
export function WriteUp({ colors, source, workspaceId, workspaceDirectory, onOpen }: {
  colors: Colors;
  source: Attachment;
  workspaceId: string;
  workspaceDirectory: string;
  onOpen(attachment: Attachment, group: Attachment[]): void;
}) {
  const fetchPreview = useRpc(previewDeliverable);
  const readable = Boolean(source.path && previewKind(source.path) === "text");
  // The same query as the preview dialog, so opening the file after reading here is instant.
  const preview = useQuery({
    queryKey: ["progress", "preview", workspaceId, source.ref, source.path],
    queryFn: () => fetchPreview({ workspaceId, workspaceDirectory, ref: source.ref }),
    staleTime: 30_000,
    enabled: readable,
  });
  const [all, setAll] = useState(false);
  const blocks = preview.data?.kind === "text" ? parseWriteUp(preview.data.text) : [];
  const excerpt = writeUpExcerpt(blocks, 280);
  const shown = all ? withoutTitle(blocks) : excerpt.blocks;
  return (
    <View style={{ gap: 12, padding: 14, borderRadius: 8, backgroundColor: colors.surface0 }}>
      {shown.length ? <View style={{ gap: 8 }}>{shown.map((block, index) => <BlockView key={index} colors={colors} block={block} first={index === 0} />)}</View> : null}
      {preview.error ? <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>Couldn't read it here: {preview.error.message}</Text> : null}
      {/* The file on the left, opening it whole; expanding in place on the right. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <TextButton colors={colors} icon={attachmentIcon(source)} label={source.title} accessibilityLabel={`Open ${source.title}`} onPress={() => onOpen(source, [source])} grow />
        <View style={{ flex: 1 }} />
        {excerpt.more ? <TextButton colors={colors} label={all ? "Show less" : "Read more"} onPress={() => setAll(!all)} expanded={all} /> : null}
      </View>
    </View>
  );
}

// A quiet text button for the inset's footer: muted, tinted on hover.
function TextButton({ colors, icon, label, accessibilityLabel, onPress, grow = false, expanded }: {
  colors: Colors; icon?: string; label: string; accessibilityLabel?: string; onPress(): void; grow?: boolean; expanded?: boolean;
}) {
  return (
    <PressableRow colors={colors} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={expanded === undefined ? undefined : { expanded }} onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 3, paddingHorizontal: 6, marginHorizontal: -6, borderRadius: 4, flexShrink: grow ? 1 : 0, minWidth: 0 }}>
      {icon ? <Icon name={icon} size={12} color={colors.foregroundMuted} /> : null}
      <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17, fontWeight: "500" }}>{label}</Text>
    </PressableRow>
  );
}

function BlockView({ colors, block, first }: { colors: Colors; block: Block; first: boolean }) {
  switch (block.kind) {
    case "heading":
      return (
        // A step under the section's own 13px title: smaller and muted, set apart from the body by weight.
        <Text accessibilityRole="header" selectable style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17, fontWeight: "600", marginTop: first ? 0 : 6 }}>
          <Spans colors={colors} spans={block.spans} />
        </Text>
      );
    case "item":
      return (
        <View style={{ flexDirection: "row", gap: 6, paddingStart: block.depth * 14 }}>
          <Text style={{ minWidth: 10, color: colors.foregroundMuted, fontSize: 13, lineHeight: 19, fontVariant: ["tabular-nums"] }}>{block.marker}</Text>
          <Text selectable style={{ flex: 1, color: colors.foreground, fontSize: 13, lineHeight: 19 }}><Spans colors={colors} spans={block.spans} /></Text>
        </View>
      );
    case "code":
      return (
        <View style={{ padding: 8, borderRadius: 6, backgroundColor: colors.surface0 }}>
          <Text selectable style={{ color: colors.foreground, fontFamily: MONO, fontSize: 12, lineHeight: 18 }}>{block.text}</Text>
        </View>
      );
    default:
      return <Text selectable style={{ color: colors.foreground, fontSize: 13, lineHeight: 19 }}><Spans colors={colors} spans={block.spans} /></Text>;
  }
}

function Spans({ colors, spans }: { colors: Colors; spans: Span[] }) {
  return <>{spans.map((span, index) => span.code
    ? <Text key={index} style={{ fontFamily: MONO, fontSize: 12, color: colors.foreground }}>{span.text}</Text>
    : <React.Fragment key={index}>{span.text}</React.Fragment>)}</>;
}
