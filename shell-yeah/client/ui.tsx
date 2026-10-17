import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Platform, Pressable, Text, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import type { Badge as BadgeKind, Tone } from "../shared/view.ts";
import { isLight, withAlpha, type ThemeColors } from "./palette.ts";

// Read at render time, not import time. The native driver can't run on web,
// and web is the only place filter blur renders.
const isWeb = () => Platform.OS === "web";
export const nativeDriver = () => !isWeb();
const easeOut = () => Easing.out(Easing.ease);
const iconCurve = () => Easing.bezier(0.2, 0, 0, 1);

// Code and commands: the platform's monospace face.
export const mono = () => (Platform.OS === "ios" ? "Menlo" : Platform.OS === "web" ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "monospace");

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => live && setReduced(value));
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

// Depth for the card: a soft shadow stack in light themes, one 8% white ring in dark ones.
export function raised(colors: ThemeColors): ViewStyle {
  const light = isLight(colors);
  if (light === null) return { borderWidth: 1, borderColor: colors.border };
  return {
    boxShadow: light
      ? "0px 0px 0px 1px rgba(0, 0, 0, 0.06), 0px 1px 2px -1px rgba(0, 0, 0, 0.06), 0px 2px 4px 0px rgba(0, 0, 0, 0.04)"
      : "0px 0px 0px 1px rgba(255, 255, 255, 0.08)",
  };
}

export function toneColor(tone: Tone, colors: ThemeColors): string {
  switch (tone) {
    case "success": return colors.statusSuccess;
    case "danger": return colors.statusDanger;
    case "warning": return colors.statusWarning;
    case "active": return colors.accent;
    case "muted": return colors.foregroundMuted;
  }
}

// A button that scales to 0.96 while pressed.
export function PressScale({ style, outerStyle, children, ...props }: Omit<PressableProps, "style" | "children"> & {
  outerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean; hovered: boolean }) => StyleProp<ViewStyle>);
  children: React.ReactNode;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (toValue: number) => Animated.timing(scale, { toValue, duration: 150, easing: easeOut(), useNativeDriver: nativeDriver() }).start();
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable {...props} style={outerStyle}
      onHoverIn={(event) => { setHovered(true); props.onHoverIn?.(event); }}
      onHoverOut={(event) => { setHovered(false); props.onHoverOut?.(event); }}
      onPressIn={(event) => { setPressed(true); to(0.96); props.onPressIn?.(event); }}
      onPressOut={(event) => { setPressed(false); to(1); props.onPressOut?.(event); }}>
      <Animated.View style={[typeof style === "function" ? style({ pressed, hovered }) : style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

// Cross-fades an icon when `swapKey` changes: the new one grows from 0.25 while
// the old one shrinks away. Nothing animates on first render.
export function IconSwap({ swapKey, size, children }: { swapKey: string; size: number; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(swapKey);
  const [leaving, setLeaving] = useState<React.ReactNode>(null);
  const last = useRef(children);
  const enter = useRef(new Animated.Value(1)).current;
  if (swapKey !== shown) {
    setShown(swapKey);
    setLeaving(reduced ? null : last.current);
  }
  useLayoutEffect(() => {
    last.current = children;
  });
  useLayoutEffect(() => {
    if (!leaving) return;
    enter.setValue(0);
    const animation = Animated.timing(enter, { toValue: 1, duration: 300, easing: iconCurve(), useNativeDriver: nativeDriver() });
    animation.start(({ finished }) => finished && setLeaving(null));
    return () => animation.stop();
  }, [shown]);
  const layer = (value: Animated.AnimatedInterpolation<number> | Animated.Value, blurFrom: [number, number]) => ({
    opacity: value,
    transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }],
    ...(isWeb() && leaving ? { filter: value.interpolate({ inputRange: [0, 1], outputRange: blurFrom.map((px) => `blur(${px}px)`) }) } : null),
  });
  const exit = enter.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  return (
    <Animated.View style={{ width: size, height: size }}>
      {leaving ? <Animated.View style={[{ position: "absolute", top: 0, left: 0 }, layer(exit, [4, 0])]}>{leaving}</Animated.View> : null}
      <Animated.View style={layer(enter, [4, 0])}>{children}</Animated.View>
    </Animated.View>
  );
}

// A play triangle's visual center sits left of its box; one pixel right centers it.
function Nudge({ children }: { children: React.ReactNode }) {
  return <View style={{ transform: [{ translateX: 1 }] }}>{children}</View>;
}

// The system spinner, sized to sit beside a line of text. iOS draws it only at 20pt.
export function Spinner({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <View accessibilityLabel="Working" style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {Platform.OS === "ios"
        ? <ActivityIndicator size="small" color={color} style={{ transform: [{ scale: size / 20 }] }} />
        : <ActivityIndicator size={size} color={color} />}
    </View>
  );
}

const BADGE_ICON: Record<Exclude<BadgeKind, "spinner">, string> = { play: "Play", check: "Check", x: "X", square: "Square", unplug: "Unplug" };

// 20 px status tile: a tinted circle with a 12 px glyph that morphs between states.
export function Badge({ kind, tone, colors }: { kind: BadgeKind; tone: Tone; colors: ThemeColors }) {
  const color = toneColor(tone, colors);
  const light = isLight(colors) ?? false;
  const glyph = kind === "spinner" ? <Spinner color={colors.accent} size={12} /> : kind === "play" ? <Nudge><Icon name="Play" size={12} color={color} /></Nudge> : <Icon name={BADGE_ICON[kind]} size={12} color={color} />;
  return (
    <View style={[
      { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
      { backgroundColor: withAlpha(color, light ? 0.12 : 0.14) },
      kind === "play" ? { borderWidth: 1, borderStyle: "dashed", borderColor: withAlpha(color, 0.6), backgroundColor: "transparent" } : null,
    ]}>
      <IconSwap swapKey={kind} size={12}>{glyph}</IconSwap>
    </View>
  );
}

export type ButtonTone = "primary" | "quiet" | "danger" | "danger-filled";

export function Button({ icon, label, reserveLabel, tone, onPress, busy = false, disabled = false, compact, iconOnly = false, floating = false, colors, accessibilityLabel }: {
  icon: string;
  label: string;
  // A longer label this button can switch to ("Copied"), so the switch doesn't shift its neighbors.
  reserveLabel?: string;
  tone: ButtonTone;
  onPress(): void;
  busy?: boolean;
  disabled?: boolean;
  compact: boolean;
  iconOnly?: boolean;
  // Lifted with the card's ring, for a button that sits over content.
  floating?: boolean;
  colors: ThemeColors;
  accessibilityLabel: string;
}) {
  const filled = tone === "primary" || tone === "danger-filled";
  const background = tone === "primary" ? colors.accent : tone === "danger-filled" ? colors.statusDanger : colors.surface2;
  const foreground = tone === "primary" ? colors.accentForeground : tone === "danger-filled" ? colors.surface0 : tone === "danger" ? colors.statusDanger : colors.foreground;
  const height = compact ? 36 : 28;
  const labelStyle = { color: foreground, fontSize: 12, lineHeight: 16, fontWeight: filled ? ("600" as const) : ("500" as const) };
  const showLabel = !iconOnly || filled;
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ hovered }) => ({
        ...(floating ? raised(colors) : null),
        height,
        minWidth: height,
        borderRadius: 6,
        paddingStart: showLabel ? 8 : 0,
        paddingEnd: showLabel ? 10 : 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        backgroundColor: filled || !hovered || disabled ? background : colors.border,
        opacity: disabled ? 0.5 : filled && hovered ? 0.88 : 1,
      })}>
      <IconSwap swapKey={busy ? "busy" : icon} size={14}>
        {busy ? <Spinner color={foreground} size={14} /> : icon === "Play" ? <Nudge><Icon name={icon} size={14} color={foreground} /></Nudge> : <Icon name={icon} size={14} color={foreground} />}
      </IconSwap>
      {showLabel ? (
        <View>
          {reserveLabel ? <Text accessible={false} importantForAccessibility="no" style={[labelStyle, { opacity: 0 }]}>{reserveLabel}</Text> : null}
          <Text style={[labelStyle, reserveLabel ? { position: "absolute", left: 0, right: 0, top: 0, textAlign: "center" } : null]}>{label}</Text>
        </View>
      ) : null}
    </PressScale>
  );
}
