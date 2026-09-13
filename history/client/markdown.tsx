import { HoverButton } from "./hover-button";
import React, { memo, useMemo, type ReactNode } from "react";
import { Linking, Platform, ScrollView, Text, View, type TextStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import type { Token, Tokens } from "marked";
import { linkAction, markdownTokens } from "../shared/markdown";

type Props = {
  text: string;
  colors: PluginButtonIconProps["theme"]["colors"];
  copy(text: string): void;
  onError(message: string): void;
};

export const MarkdownMessage = memo(function MarkdownMessage({ text, colors, copy, onError }: Props) {
  const tokens = useMemo(() => markdownTokens(text), [text]);
  const mono = Platform.OS === "ios" ? "Menlo" : "monospace";
  const body: TextStyle = { color: colors.foreground, fontSize: 13, lineHeight: 21 };

  function inline(items: Token[] = []): ReactNode {
    return items.map((token, index) => {
      if (token.type === "memory_citation") return null;
      if (token.type === "br") return "\n";
      if (token.type === "strong" || token.type === "em" || token.type === "del") {
        const style: TextStyle = token.type === "strong" ? { fontWeight: "700" }
          : token.type === "em" ? { fontStyle: "italic" } : { textDecorationLine: "line-through" };
        return <Text key={index} style={style}>{inline(token.tokens)}</Text>;
      }
      if (token.type === "codespan") return <Text key={index} style={{ fontFamily: mono, fontSize: 12, backgroundColor: colors.surface2 }}>{token.text}</Text>;
      if (token.type === "link" || token.type === "image") {
        const href = token.href;
        const open = linkAction(href) === "open";
        return <Text key={index} accessibilityRole={open ? "link" : "button"}
          accessibilityLabel={`${open ? "Open" : "Copy destination:"} ${token.text}`}
          style={{ color: colors.accent, textDecorationLine: "underline" }} onPress={() => {
            if (open) void Linking.openURL(href).catch(() => onError("Could not open this link."));
            else copy(href);
          }}>{token.type === "image" ? `[Image: ${token.text || "image"}]` : inline(token.tokens)}</Text>;
      }
      if (token.type === "text" && token.tokens) return <Text key={index}>{inline(token.tokens)}</Text>;
      return <Text key={index}>{"text" in token ? token.text : token.raw}</Text>;
    });
  }

  function blocks(items: Token[] = []): ReactNode {
    return items.map((token, index) => {
      if (["space", "def", "memory_citation"].includes(token.type)) return null;
      if (token.type === "heading") return <Text key={index} selectable accessibilityRole="header"
        style={{ ...body, fontSize: token.depth === 1 ? 18 : token.depth === 2 ? 16 : 14, lineHeight: 24, fontWeight: "600" }}>{inline(token.tokens)}</Text>;
      if (token.type === "paragraph" || token.type === "text") return <Text key={index} selectable style={body}>
        {token.tokens ? inline(token.tokens) : token.text}
      </Text>;
      if (token.type === "code") return <View key={index} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 6, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 4, backgroundColor: colors.surface1 }}>
          <Icon name="Code" size={13} color={colors.foregroundMuted} />
          <Text style={{ flex: 1, marginLeft: 7, color: colors.foregroundMuted, fontSize: 11 }}>{token.lang?.split(/\s/)[0] || "Code"}</Text>
          <HoverButton colors={colors} accessibilityRole="button" accessibilityLabel="Copy code" onPress={() => copy(token.text)}
            style={({ pressed }) => ({ minHeight: 32, paddingHorizontal: 8, flexDirection: "row", gap: 6, alignItems: "center", opacity: pressed ? 0.6 : 1 })}>
            {color => <>
              <Icon name="Copy" size={13} color={color} />
              <Text style={{ color, fontSize: 11 }}>Copy</Text>
            </>}
          </HoverButton>
        </View>
        <ScrollView horizontal style={{ backgroundColor: colors.surface0 }} contentContainerStyle={{ padding: 12 }}>
          <Text selectable style={{ color: colors.foreground, fontFamily: mono, fontSize: 12, lineHeight: 19 }}>{token.text}</Text>
        </ScrollView>
      </View>;
      if (token.type === "blockquote") return <View key={index} style={{ paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: colors.border, gap: 8 }}>{blocks(token.tokens)}</View>;
      if (token.type === "list") return <View key={index} style={{ gap: 5 }}>{token.items.map((item: Tokens.ListItem, i: number) =>
        <View key={i} style={{ flexDirection: "row", gap: 7, alignItems: "flex-start" }}>
          <Text style={{ ...body, minWidth: 16 }}>{item.task ? item.checked ? "☑" : "☐" : token.ordered ? `${Number(token.start) + i}.` : "•"}</Text>
          <View style={{ flex: 1, minWidth: 0, gap: 6 }}>{blocks(item.tokens)}</View>
        </View>)}</View>;
      if (token.type === "hr") return <View key={index} style={{ height: 1, backgroundColor: colors.border }} />;
      if (token.type === "table") return <ScrollView key={index} horizontal>
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 4 }}>
          {[token.header, ...token.rows].map((row: Tokens.TableCell[], i: number) => <View key={i} style={{ flexDirection: "row", backgroundColor: i === 0 ? colors.surface1 : colors.surface0 }}>
            {row.map((cell, j) => <Text key={j} selectable style={{ ...body, width: 180, padding: 8, fontWeight: i === 0 ? "600" : "400", textAlign: token.align[j] ?? "left" }}>{inline(cell.tokens)}</Text>)}
          </View>)}
        </View>
      </ScrollView>;
      // HTML and unfamiliar syntax stay inert and selectable.
      return <Text key={index} selectable style={body}>{token.raw}</Text>;
    });
  }

  return <View style={{ gap: 10 }}>{blocks(tokens)}</View>;
});
