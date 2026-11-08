import { Icon } from "@getpaseo/plugin/client/ui";
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Easing, Platform, View } from "react-native";
import { useProgressLanguage } from "./language";
import { nativeDriver } from "./motion";
import type { Liveness } from "../shared/dashboard";

// The system spinner, sized to sit beside a line of text. iOS draws it only
// at 20pt, so it's scaled into the slot there.
export function Spinner({ color, size = 12 }: { color: string; size?: number }) {
  const { messages: m } = useProgressLanguage();
  return (
    <View accessibilityLabel={m.status.working} style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {Platform.OS === "ios" ? (
        <ActivityIndicator size="small" color={color} style={{ transform: [{ scale: size / 20 }] }} />
      ) : (
        <ActivityIndicator size={size} color={color} />
      )}
    </View>
  );
}

// Shown in place of the spinner once no agent is running and the dashboard is
// stale: the work may have stopped, so the icon asks for attention.
export function StalledPulse({ color, size = 12 }: { color: string; size?: number }) {
  const { messages: m } = useProgressLanguage();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: nativeDriver() }),
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: nativeDriver() }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View accessibilityLabel={m.possiblyStalled} style={{ width: size, height: size, opacity }}>
      <Icon name="TriangleAlert" size={size} color={color} />
    </Animated.View>
  );
}

// A still, faded dot, so the item reads as parked rather than busy: a ticket not
// started yet or waiting on another, or work whose agent has stopped. Centered
// in the same slot an icon would take.
export function StillDot({ color, label, size = 12 }: { color: string; label: string; size?: number }) {
  const dot = Math.round(size / 2);
  return (
    <View accessibilityLabel={label} style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color, opacity: 0.5 }} />
    </View>
  );
}

export function WorkingIcon({ liveness, accent, warning, size = 12 }: { liveness: Liveness; accent: string; warning: string; size?: number }) {
  const { messages: m } = useProgressLanguage();
  switch (liveness) {
    case "running":
      return <Spinner color={accent} size={size} />;
    case "paused":
      return <StillDot color={accent} label={m.paused} size={size} />;
    case "stalled":
      return <StalledPulse color={warning} size={size} />;
  }
}
