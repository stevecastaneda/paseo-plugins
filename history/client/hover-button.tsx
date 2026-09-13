import React, { useState, type ReactNode } from "react";
import { Pressable, type PressableProps } from "react-native";
import type { PluginButtonIconProps } from "@getpaseo/plugin/client";

export function HoverButton({ colors, children, active = false, ...props }: Omit<PressableProps, "children" | "onHoverIn" | "onHoverOut"> & {
  colors: PluginButtonIconProps["theme"]["colors"];
  active?: boolean;
  children(color: string): ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return <Pressable {...props} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}>
    {children(active || (hovered && !props.disabled) ? colors.foreground : colors.foregroundMuted)}
  </Pressable>;
}
