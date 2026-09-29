import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React from "react";
import { Text, View, type ViewStyle } from "react-native";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// A card's heading: a 14px Lucide icon beside the 13px semibold title.
export function SectionTitle({ colors, icon, title, color, style, children }: {
  colors: Colors;
  icon: string;
  title: string;
  color?: string;
  style?: ViewStyle;
  children?: React.ReactNode;
}) {
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8 }, style]}>
      <Icon name={icon} size={14} color={color ?? colors.foregroundMuted} />
      <Text accessibilityRole="header" style={{ color: color ?? colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{title}</Text>
      {children}
    </View>
  );
}
