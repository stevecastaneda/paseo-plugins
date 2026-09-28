import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";

// A small spinner sized to sit beside 13px text; the stock ActivityIndicator
// is larger than a line of text.
export function Spinner({ color, size = 12 }: { color: string; size?: number }) {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View accessibilityLabel="Working" style={{ width: size, height: size, transform: [{ rotate }] }}>
      <Icon name="LoaderCircle" size={size} color={color} />
    </Animated.View>
  );
}

// Shown in place of the spinner once the dashboard is stale: the work may have
// stopped, so the icon asks for attention instead of looking busy.
export function StalledPulse({ color, size = 12 }: { color: string; size?: number }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
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
