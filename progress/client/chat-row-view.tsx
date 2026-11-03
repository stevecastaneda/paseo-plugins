import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import React, { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { type ChatRow, chatRowText } from "./chat-row";
import { useProgressLanguage } from "./language";

const mono = () => (Platform.OS === "ios" ? "Menlo" : "monospace");

// Sized like Paseo's own tool rows (ExpandableBadge in the app): 14px label,
// 12px icon centered in a 22px slot, 8 by 4 padding. The -13 margin puts the
// icon's glyph on the chat's text edge, where Paseo's rows put theirs.
export function ChatRowView({ item, theme }: PluginTimelineItemProps<ChatRow>) {
  const { colors } = theme;
  const { messages: m } = useProgressLanguage();
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const row = item.data;
  const { line, more } = chatRowText(row, m);
  const failed = row.state === "failed";
  const running = row.state === "running";
  const open = expanded && more !== null;
  // Only a row that opens lights up on hover, like Paseo's.
  const active = more !== null && (hovered || expanded);
  const iconColor = failed ? colors.statusDanger : active ? colors.foreground : colors.foregroundMuted;

  const icon = active
    ? <View style={{ marginLeft: -4, transform: [{ scale: 1.3 }, { rotate: expanded ? "90deg" : "0deg" }] }}><Icon name="ChevronRight" size={12} color={colors.foreground} /></View>
    : <View style={{ marginLeft: -1, opacity: failed ? 0.8 : 1 }}><Icon name={failed ? "TriangleAlert" : "ListChecks"} size={12} color={iconColor} /></View>;

  return (
    <View style={{ marginHorizontal: -13 }}>
      <Pressable
        disabled={more === null}
        onPress={() => setExpanded((value) => !value)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole={more === null ? undefined : "button"}
        aria-expanded={more === null ? undefined : expanded}
        aria-busy={running}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          borderRadius: 8,
          borderWidth: 1,
          borderColor: open ? colors.border : "transparent",
          borderBottomLeftRadius: open ? 0 : 8,
          borderBottomRightRadius: open ? 0 : 8,
          backgroundColor: open ? colors.surface1 : "transparent",
          paddingHorizontal: 8,
          paddingVertical: 4,
          opacity: pressed && more !== null ? 0.9 : 1,
        })}
      >
        <View style={{ width: 22, height: 22, marginRight: 4, alignItems: "center", justifyContent: "center" }}>{icon}</View>
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            fontSize: 14,
            color: failed ? colors.statusDanger : running || active ? colors.foreground : colors.foregroundMuted,
            opacity: running ? 0.72 : 1,
          }}
        >
          {line}
        </Text>
      </Pressable>
      {open ? (
        <View style={{ borderWidth: 1, borderTopWidth: 0, borderColor: colors.border, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, overflow: "hidden" }}>
          {/* Scrolling past the end stays in the output instead of moving the chat. */}
          <ScrollView style={[{ maxHeight: 320 }, Platform.OS === "web" ? ({ overscrollBehavior: "contain" } as object) : null]} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}>
            <Text selectable style={{ color: failed ? colors.statusDanger : colors.foreground, fontFamily: mono(), fontSize: 12, lineHeight: 18 }}>{more}</Text>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
