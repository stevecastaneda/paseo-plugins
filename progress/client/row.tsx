import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import React, { useState } from "react";
import { Pressable, type PressableProps, type ViewStyle } from "react-native";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// One instant tint for every pressable row, so rows that look alike respond alike.
// Each step moves one surface up; `onSurface1` rows (dialogs, the popover, the
// working ticket) start a step higher.
export function rowTint(colors: Colors, state: { hovered: boolean; pressed: boolean }, onSurface1 = false): string {
  if (onSurface1) return state.pressed ? colors.border : state.hovered ? colors.surface2 : colors.surface1;
  return state.pressed ? colors.surface2 : state.hovered ? colors.surface1 : "transparent";
}

// A full-width row that opens something. `resting` is its background at rest.
export function PressableRow({ colors, onSurface1 = false, transparentAtRest = true, style, children, ...props }: Omit<PressableProps, "style" | "children"> & {
  colors: Colors;
  onSurface1?: boolean;
  // Rows on a surface1 background rest transparent; the working ticket rests on surface1.
  transparentAtRest?: boolean;
  style?: ViewStyle;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable {...props} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      style={({ pressed }) => {
        const tint = rowTint(colors, { hovered, pressed }, onSurface1);
        return [style, { backgroundColor: !hovered && !pressed && transparentAtRest ? "transparent" : tint }];
      }}>
      {children}
    </Pressable>
  );
}
