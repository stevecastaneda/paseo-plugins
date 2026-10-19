export interface KeyPress {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

// What a terminal sends for the keys a text box doesn't type: xterm's sequences, which
// macOS, Linux and Windows terminals all read.
const SPECIAL: Record<string, string> = {
  Enter: "\r",
  Backspace: "\x7f",
  Delete: "\x1b[3~",
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
};

// The bytes for a key press, or null when the text box should handle it: letters arrive as
// typed text, Cmd shortcuts stay with the app, and Ctrl+V pastes. Ctrl+C is the interrupt.
export function terminalKeys(press: KeyPress): string | null {
  if (press.metaKey) return null;
  if (press.ctrlKey && !press.altKey && /^[a-z]$/i.test(press.key)) {
    return press.key.toLowerCase() === "v" ? null : String.fromCharCode(press.key.toUpperCase().charCodeAt(0) - 64);
  }
  return SPECIAL[press.key] ?? null;
}
