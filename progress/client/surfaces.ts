import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import type { ViewStyle } from "react-native";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// The red, green and blue of a #rgb/#rrggbb or rgb() color, or null when unreadable.
function channels(color: string): number[] | null {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d) : hex[1].match(/../g)!;
    return digits.map((d) => parseInt(d, 16));
  }
  const fn = color.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  return fn ? fn.slice(1, 4).map(Number) : null;
}

// Relative luminance, or null when the color is unreadable.
function luminance(color: string): number | null {
  const rgb = channels(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isLight(colors: Colors): boolean | null {
  const value = luminance(colors.surface0);
  return value === null ? null : value > 0.4;
}

// A 1px ring just inside an image: pure black or white at 10%, never a tinted gray.
export function imageOutline(colors: Colors): { borderWidth: number; borderColor: string } {
  return { borderWidth: 1, borderColor: isLight(colors) === false ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)" };
}

// Depth for cards and bordered buttons: a transparent ring plus lift in light
// themes, one white ring in dark ones. Dividers and state borders stay borders.
export function raised(colors: Colors): ViewStyle {
  const light = isLight(colors);
  if (light === null) return { borderWidth: 1, borderColor: colors.border };
  return {
    boxShadow: light
      ? "0px 0px 0px 1px rgba(0, 0, 0, 0.06), 0px 1px 2px -1px rgba(0, 0, 0, 0.06), 0px 2px 4px 0px rgba(0, 0, 0, 0.04)"
      : "0px 0px 0px 1px rgba(255, 255, 255, 0.08)",
  };
}

// A color at low opacity, for a tag's fill: the same hue as its text, never a
// drifting second color. Paseo's own status badges use 12% in light themes and
// 16% in dark ones, where the surface swallows more of it.
export function tint(color: string, colors: Colors): string {
  return withAlpha(color, isLight(colors) ? 0.12 : 0.16) ?? colors.surface2;
}

// The color at the given opacity, or null when the color is unreadable.
export function withAlpha(color: string, alpha: number): string | null {
  const rgb = channels(color);
  return rgb ? `rgba(${rgb.join(", ")}, ${alpha})` : null;
}
