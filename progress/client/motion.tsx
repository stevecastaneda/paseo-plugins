import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

// Read at render time, not import time. The native driver can't run on web,
// and web is the only place filter blur renders.
const isWeb = () => Platform.OS === "web";
// On web, react-native-web falls back to JS for `useNativeDriver: true` but
// Animated.loop still takes the native path and plays one iteration.
export const nativeDriver = () => !isWeb();
const easeOut = () => Easing.out(Easing.ease);
const iconCurve = () => Easing.bezier(0.2, 0, 0, 1);

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

// The last non-null value, so a dialog keeps its content while it animates
// closed instead of collapsing mid-exit.
export function useLastPresent<T>(value: T | null): T | null {
  const last = useRef(value);
  if (value !== null) last.current = value;
  return value ?? last.current;
}

// A button that scales to 0.96 while pressed. `static` turns the scale off.
export function PressScale({ static: isStatic, style, outerStyle, children, ...props }: Omit<PressableProps, "style" | "children"> & {
  static?: boolean;
  // Layout for the pressable itself, e.g. alignSelf; `style` is what scales.
  outerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean; hovered: boolean }) => StyleProp<ViewStyle>);
  children: React.ReactNode;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  // Timing retargets from the current value, so a release mid-press eases back.
  const to = (toValue: number) => Animated.timing(scale, { toValue, duration: 150, easing: easeOut(), useNativeDriver: nativeDriver() }).start();
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable {...props} style={outerStyle}
      onHoverIn={(event) => { setHovered(true); props.onHoverIn?.(event); }}
      onHoverOut={(event) => { setHovered(false); props.onHoverOut?.(event); }}
      onPressIn={(event) => { setPressed(true); if (!isStatic) to(0.96); props.onPressIn?.(event); }}
      onPressOut={(event) => { setPressed(false); if (!isStatic) to(1); props.onPressOut?.(event); }}>
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

// Sections that mount within this long of the panel stagger in; later ones enter at once.
const FIRST_LOAD_MS = 1000;
const StaggerStart = createContext<number | null>(null);

export function StaggerRoot({ children }: { children: React.ReactNode }) {
  const [start] = useState(() => Date.now());
  return <StaggerStart.Provider value={start}>{children}</StaggerStart.Provider>;
}

const ENTER_MS = 300;
const STAGGER_MS = 60;

// Fades a section in (opacity, 12px rise, blur) and out (150ms, 12px lift).
// `order` staggers the first load by 60ms per section, so the last is in by ~0.6s.
export function Presence({ show, order = 0, children }: { show: boolean; order?: number; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const start = useContext(StaggerStart);
  const [mounted, setMounted] = useState(show);
  const last = useRef(children);
  if (show) last.current = children;
  const enter = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  // Filter only while animating: a resting blur(0px) still costs a layer and can soften text.
  const [moving, setMoving] = useState(false);
  if (show && !mounted) setMounted(true);

  useEffect(() => {
    if (!mounted) return;
    if (show) {
      exit.setValue(0);
      if (reduced) {
        enter.setValue(1);
        return;
      }
      const firstLoad = start !== null && Date.now() - start < FIRST_LOAD_MS;
      const animation = Animated.timing(enter, { toValue: 1, duration: ENTER_MS, delay: firstLoad ? order * STAGGER_MS : 0, easing: easeOut(), useNativeDriver: nativeDriver() });
      setMoving(true);
      animation.start(({ finished }) => finished && setMoving(false));
      return () => animation.stop();
    }
    if (reduced) {
      setMounted(false);
      return;
    }
    const animation = Animated.timing(exit, { toValue: 1, duration: 150, easing: easeOut(), useNativeDriver: nativeDriver() });
    setMoving(true);
    animation.start(({ finished }) => {
      if (finished) {
        enter.setValue(0);
        setMoving(false);
        setMounted(false);
      }
    });
    return () => animation.stop();
  }, [show, mounted]);

  if (!mounted) return null;
  const opacity = Animated.multiply(enter, exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }));
  const translateY = Animated.add(
    enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }),
    exit.interpolate({ inputRange: [0, 1], outputRange: [0, -12] }),
  );
  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, isWeb() && moving ? blurStyle(enter, exit) : null]}>
      {show ? children : last.current}
    </Animated.View>
  );
}

function blurStyle(enter: Animated.Value, exit: Animated.Value) {
  // Blur is 4px at either end of the motion and 0 at rest.
  const amount = Animated.add(
    enter.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }),
    exit.interpolate({ inputRange: [0, 1], outputRange: [0, 4] }),
  );
  return { filter: amount.interpolate({ inputRange: [0, 4], outputRange: ["blur(0px)", "blur(4px)"] }) };
}
