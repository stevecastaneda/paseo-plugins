import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, Markdown } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { Platform, Text, View } from "react-native";
import { previewKind } from "../shared/attachments";
import { previewDeliverable } from "../shared/rpc";
import { demoteHeadings, dropTitle, markdownExcerpt, textExcerpt } from "../shared/markdown";
import { type Block, type Span } from "../shared/write-up";
import { type Attachment, attachmentIcon } from "./attachments";
import { PressableRow } from "./row";
import { errorText } from "./errors";
import { useProgressLanguage } from "./language";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";

// The one heading level a write-up draws, so its headings sit under the dialog's title.
const WRITE_UP_HEADING = 5;
const EXCERPT_CHARS = 280;

// What the ticket is: the start of its write-up in a quiet inset, with the
// rest a press away. A link or a file that isn't text shows only its name.
export function WriteUp({ colors, source, workspaceId, workspaceDirectory, onOpen }: {
  colors: Colors;
  source: Attachment;
  workspaceId: string;
  workspaceDirectory: string;
  onOpen(attachment: Attachment, group: Attachment[]): void;
}) {
  const { messages: m } = useProgressLanguage();
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
  const data = preview.data;
  const parts = useMemo(() => {
    if (data?.kind === "markdown") {
      const excerpt = markdownExcerpt(data.markdown, EXCERPT_CHARS);
      return { markdown: true, excerpt: demoteHeadings(excerpt.text, WRITE_UP_HEADING), whole: demoteHeadings(dropTitle(data.markdown), WRITE_UP_HEADING), more: excerpt.more, truncated: data.truncated };
    }
    if (data?.kind === "text") {
      const excerpt = textExcerpt(data.text, EXCERPT_CHARS);
      return { markdown: false, excerpt: excerpt.text, whole: data.text, more: excerpt.more, truncated: data.truncated };
    }
    return null;
  }, [data]);
  const shown = parts ? (all ? parts.whole : parts.excerpt) : "";
  const muted = { color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 } as const;
  return (
    <View style={{ gap: 12, padding: 14, borderRadius: 8, backgroundColor: colors.surface0 }}>
      {shown.trim() ? (parts?.markdown ? <Markdown>{shown}</Markdown>
        : <Text selectable style={{ color: colors.foreground, fontSize: 13, lineHeight: 19 }}>{shown}</Text>) : null}
      {all && parts?.truncated ? <Text style={muted}>{m.truncatedText}</Text> : null}
      {preview.error ? <Text style={muted}>{m.readError(errorText(preview.error, m.unknownError))}</Text> : null}
      {/* The file on the left, opening it whole; expanding in place on the right. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <TextButton colors={colors} icon={attachmentIcon(source)} label={source.title} accessibilityLabel={m.openItem(source.title)} onPress={() => onOpen(source, [source])} grow />
        <View style={{ flex: 1 }} />
        {parts?.more ? <TextButton colors={colors} label={all ? m.showLess : m.readMore} onPress={() => setAll(!all)} expanded={all} /> : null}
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

export function BlockView({ colors, block, first }: { colors: Colors; block: Block; first: boolean }) {
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

export function Spans({ colors, spans }: { colors: Colors; spans: Span[] }) {
  return <>{spans.map((span, index) => span.code
    ? <Text key={index} style={{ fontFamily: MONO, fontSize: 12, color: colors.foreground }}>{span.text}</Text>
    : span.strong ? <Text key={index} style={{ fontWeight: "600" }}>{span.text}</Text>
    : <React.Fragment key={index}>{span.text}</React.Fragment>)}</>;
}
