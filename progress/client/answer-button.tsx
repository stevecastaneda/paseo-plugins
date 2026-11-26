import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import React from "react";
import { Text } from "react-native";
import { PressScale } from "./motion";
import { raised } from "./surfaces";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// The background of a button that stands off the surface it's on.
export type ButtonFill = { rest: string; pressed: string };

// The small Send and Copy buttons of a question.
export function AnswerButton({
  colors,
  button,
  icon,
  label,
  accessibilityLabel,
  disabled = false,
  onPress,
}: {
  colors: Colors;
  button: ButtonFill;
  icon: "ArrowUp" | "Check" | "Clock" | "Copy" | "X";
  label?: string;
  accessibilityLabel: string;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingLeft: 6,
        paddingRight: label ? 8 : 6,
        paddingVertical: label ? 3 : 5,
        borderRadius: 4,
        opacity: disabled ? 0.6 : 1,
        ...raised(colors),
        backgroundColor: pressed ? button.pressed : button.rest,
      })}
    >
      <Icon name={icon} size={12} color={colors.foreground} />
      {label ? <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 16 }}>{label}</Text> : null}
    </PressScale>
  );
}
