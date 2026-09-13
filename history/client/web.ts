import { Platform } from "react-native";

type BubblingEvent = { stopPropagation(): void };
type KeyEvent = BubblingEvent & { key: string };

function stop(event: BubblingEvent) { event.stopPropagation(); }
function stopActivationKey(event: KeyEvent) {
  if (event.key === "Enter" || event.key === " ") event.stopPropagation();
}

// A web modal is a React portal: events still bubble to the composer Pressable
// in its React ancestry. Isolate its actions without blocking Escape dismissal.
export function modalEventBoundary() {
  return Platform.OS === "web" ? {
    onClick: stop,
    onKeyDown: stopActivationKey,
    onKeyUp: stopActivationKey,
  } : {};
}
