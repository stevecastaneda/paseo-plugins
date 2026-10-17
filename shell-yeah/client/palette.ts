import type { PluginTheme } from "@getpaseo/plugin";

export type ThemeColors = PluginTheme["colors"];

export interface Style {
  // CSS colors already resolved against the theme; null = the well's default text.
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  hidden: boolean;
}

export interface Palette {
  light: boolean;
  text: string;
  well: string;
  // 16 entries, in ANSI order.
  ansi: readonly string[];
  // Memoized per sgr string. Pure given the palette.
  style(sgr: string): Style;
}

export const MIN_CONTRAST = 3.5;

type Rgb = [number, number, number];

const PLAIN: Style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, strike: false, hidden: false };

const TAILWIND = {
  dark: { blue: "#60a5fa", magenta: "#c084fc", cyan: "#22d3ee", brightBlue: "#93c5fd", brightMagenta: "#d8b4fe", brightCyan: "#67e8f9" },
  light: { blue: "#2563eb", magenta: "#9333ea", cyan: "#0891b2", brightBlue: "#1d4ed8", brightMagenta: "#7e22ce", brightCyan: "#0e7490" },
};

const FALLBACK: ThemeColors = {
  surface0: "#18181b", surface1: "#1f1f23", surface2: "#27272a", border: "#3f3f46", foreground: "#f4f4f5", foregroundMuted: "#a1a1aa",
  accent: "#e4e4e7", accentForeground: "#18181b", statusSuccess: "#6cb17b", statusWarning: "#c09664", statusDanger: "#d8847b",
};

export function parseColor(color: string): Rgb | null {
  const hex = color.trim().match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const h = hex[1];
    const digits = h.length <= 4 ? [...h.slice(0, 3)].map((d) => d + d) : h.slice(0, 6).match(/../g)!;
    return digits.map((d) => parseInt(d, 16)) as Rgb;
  }
  const fn = color.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  return fn ? (fn.slice(1, 4).map(Number) as Rgb) : null;
}

const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

export function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return 1;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

export function mix(a: string, b: string, amount: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return a;
  return toHex(x.map((v, i) => v + (y[i] - v) * amount) as Rgb);
}

export function withAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color;
}

// Light or dark, from surface0's luminance, as playwright-pulse decides it. null when unreadable.
export function isLight(colors: ThemeColors): boolean | null {
  const rgb = parseColor(colors.surface0);
  return rgb ? luminance(rgb) > 0.4 : null;
}

// Moves `fg` toward white (on a dark background) or black (on a light one), keeping its hue,
// until it reads against `bg`. If nothing within reach does, the better of the two fallbacks.
export function ensureContrast(fg: string, bg: string, min: number, fallbacks: readonly [string, string]): string {
  if (contrastRatio(fg, bg) >= min) return fg;
  const bgRgb = parseColor(bg);
  const toward = bgRgb && luminance(bgRgb) > 0.4 ? "#000000" : "#ffffff";
  for (let amount = 0.1; amount <= 1; amount += 0.1) {
    const candidate = mix(fg, toward, amount);
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return contrastRatio(fallbacks[0], bg) >= contrastRatio(fallbacks[1], bg) ? fallbacks[0] : fallbacks[1];
}

function ansiColors(colors: ThemeColors, light: boolean): string[] {
  const t = light ? TAILWIND.light : TAILWIND.dark;
  const bright = (c: string) => (light ? mix(c, "#000000", 0.15) : mix(c, colors.foreground, 0.2));
  return [
    mix(colors.surface2, colors.foregroundMuted, 0.45),
    colors.statusDanger,
    colors.statusSuccess,
    colors.statusWarning,
    t.blue,
    t.magenta,
    t.cyan,
    mix(colors.foreground, colors.surface0, 0.15),
    colors.foregroundMuted,
    bright(colors.statusDanger),
    bright(colors.statusSuccess),
    bright(colors.statusWarning),
    t.brightBlue,
    t.brightMagenta,
    t.brightCyan,
    colors.foreground,
  ];
}

// xterm's 256-color table: the 16 theme colors, a 6x6x6 cube, then a 24-step gray ramp.
function color256(n: number, ansi: readonly string[]): string {
  if (n < 16) return ansi[n];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return toHex([v, v, v]);
  }
  const i = n - 16;
  const step = (v: number) => (v === 0 ? 0 : 55 + v * 40);
  return toHex([step(Math.floor(i / 36)), step(Math.floor((i % 36) / 6)), step(i % 6)]);
}

// 16 ANSI colors from the 11 theme colors, so output looks like the app, not like xterm.
// Every span is contrast-guarded against the background it really sits on.
export function makePalette(input: ThemeColors): Palette {
  const readable = Object.values(input).every((c) => typeof c === "string" && parseColor(c) !== null);
  const colors = readable ? input : FALLBACK;
  const light = isLight(colors) ?? false;
  const well = light ? colors.surface2 : colors.surface0;
  const text = colors.foreground;
  const ansi = ansiColors(colors, light);
  const cache = new Map<string, Style>();

  function resolve(params: number[], i: number): { color: string | null; used: number } {
    const p = params[i];
    if ((p >= 30 && p <= 37) || (p >= 40 && p <= 47)) return { color: ansi[p % 10], used: 1 };
    if ((p >= 90 && p <= 97) || (p >= 100 && p <= 107)) return { color: ansi[8 + (p % 10)], used: 1 };
    if (p === 39 || p === 49) return { color: null, used: 1 };
    if ((p === 38 || p === 48) && params[i + 1] === 5 && params.length > i + 2) return { color: color256(params[i + 2], ansi), used: 3 };
    if ((p === 38 || p === 48) && params[i + 1] === 2 && params.length > i + 4) return { color: toHex([params[i + 2], params[i + 3], params[i + 4]]), used: 5 };
    return { color: null, used: 1 };
  }

  function style(sgr: string): Style {
    const hit = cache.get(sgr);
    if (hit) return hit;
    const s: Style = { ...PLAIN };
    let fg: string | null = null;
    let bg: string | null = null;
    let inverse = false;
    const params = sgr === "" ? [] : sgr.split(";").map(Number);
    for (let i = 0; i < params.length; ) {
      const p = params[i];
      if (p === 1) s.bold = true;
      else if (p === 2) s.dim = true;
      else if (p === 3) s.italic = true;
      else if (p === 4) s.underline = true;
      else if (p === 7) inverse = true;
      else if (p === 8) s.hidden = true;
      else if (p === 9) s.strike = true;
      else if ((p >= 30 && p <= 39) || (p >= 90 && p <= 97)) {
        const r = resolve(params, i);
        fg = r.color;
        i += r.used;
        continue;
      } else if ((p >= 40 && p <= 49) || (p >= 100 && p <= 107)) {
        const r = resolve(params, i);
        bg = r.color;
        i += r.used;
        continue;
      }
      i++;
    }
    if (inverse) [fg, bg] = [bg ?? well, fg ?? text];
    const surface = bg ?? well;
    let resolved = fg ?? (bg ? text : null);
    if (s.hidden) resolved = surface;
    else if (resolved !== null) {
      if (s.dim) resolved = mix(resolved, surface, 0.4);
      resolved = ensureContrast(resolved, surface, MIN_CONTRAST, [colors.surface0, colors.foreground]);
    } else if (s.dim) {
      resolved = ensureContrast(mix(text, surface, 0.4), surface, MIN_CONTRAST, [colors.surface0, colors.foreground]);
    }
    s.fg = resolved;
    s.bg = bg;
    cache.set(sgr, s);
    return s;
  }

  return { light, text, well, ansi, style };
}
