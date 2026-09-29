import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Easing, Platform, View } from "react-native";
import { nativeDriver } from "./motion";

// The system spinner, sized to sit beside a line of text. iOS draws it only
// at 20pt, so it's scaled into the slot there.
export function Spinner({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <View accessibilityLabel="Working" style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {Platform.OS === "ios"
        ? <ActivityIndicator size="small" color={color} style={{ transform: [{ scale: size / 20 }] }} />
        : <ActivityIndicator size={size} color={color} />}
    </View>
  );
}

// Shown in place of the spinner once the dashboard is stale: the work may have
// stopped, so the icon asks for attention instead of looking busy.
export function StalledPulse({ color, size = 12 }: { color: string; size?: number }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: nativeDriver() }),
      Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: nativeDriver() }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View accessibilityLabel="Possibly stalled" style={{ width: size, height: size, opacity }}>
      <Icon name="TriangleAlert" size={size} color={color} />
    </Animated.View>
  );
}

// A ticket waiting on another one: a still, faded dot, so it reads as parked
// rather than busy. Centered in the same slot an icon would take.
export function WaitingDot({ color, size = 12 }: { color: string; size?: number }) {
  const dot = Math.round(size / 2);
  return (
    <View accessibilityLabel="Waiting" style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color, opacity: 0.5 }} />
    </View>
  );
}
