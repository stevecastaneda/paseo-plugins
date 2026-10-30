import { type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import React from "react";
import { Platform, Text, View } from "react-native";
import { type Block, type Span } from "../shared/blocks";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";

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
