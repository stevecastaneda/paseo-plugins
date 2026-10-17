import assert from "node:assert/strict";
import { test } from "node:test";
import { MIN_CONTRAST, contrastRatio, ensureContrast, isLight, makePalette, type ThemeColors } from "./palette.ts";

// Paseo 0.11.2's default light and zinc dark themes (packages/app/src/styles/theme.ts).
const LIGHT: ThemeColors = { surface0: "#ffffff", surface1: "#fafafa", surface2: "#f4f4f5", border: "#e4e4e7", foreground: "#1a1a1e", foregroundMuted: "#71717a", accent: "#20744A", accentForeground: "#ffffff", statusSuccess: "#3e704a", statusDanger: "#9d433b", statusWarning: "#7b5d39" };
const DARK: ThemeColors = { surface0: "#18181b", surface1: "#1f1f22", surface2: "#27272a", border: "#27272a", foreground: "#fafafa", foregroundMuted: "#a1a1aa", accent: "#e4e4e7", accentForeground: "#18181b", statusSuccess: "#6cb17b", statusDanger: "#d8847b", statusWarning: "#c09664" };

const SGRS = ["", "1", "2", "31", "1;31", "32", "33", "34", "35", "36", "37", "90", "91", "92", "93", "94", "95", "96", "97", "30;42", "37;41", "7;32", "38;5;208", "38;5;17", "48;5;22;37", "38;2;0;0;128", "38;2;255;255;255", "2;34", "4;36", "9;35", "3;33"];

for (const [name, theme] of [["light", LIGHT], ["dark", DARK]] as const) {
  test(`${name} theme: every styled span reads at ${MIN_CONTRAST}:1 against the background it sits on`, () => {
    const p = makePalette(theme);
    assert.equal(p.light, name === "light");
    assert.equal(new Set([...p.ansi, p.well]).size, 17, "16 ANSI colors and the well are all distinct");
    for (const sgr of SGRS) {
      const s = p.style(sgr);
      const bg = s.bg ?? p.well;
      const fg = s.fg ?? p.text;
      if (s.hidden) continue;
      assert.ok(contrastRatio(fg, bg) >= MIN_CONTRAST, `${name} ${JSON.stringify(sgr)}: ${fg} on ${bg} is ${contrastRatio(fg, bg).toFixed(2)}`);
    }
    assert.equal(p.style("8").fg, p.well, "hidden text is painted in the well color");
  });
}

test("red, green and yellow are the theme's own status colors; the brights lean toward the foreground", () => {
  const dark = makePalette(DARK);
  assert.deepEqual(dark.ansi.slice(1, 4), [DARK.statusDanger, DARK.statusSuccess, DARK.statusWarning]);
  assert.equal(dark.ansi[15], DARK.foreground);
  assert.equal(dark.ansi[8], DARK.foregroundMuted);
  assert.ok(contrastRatio(dark.ansi[9], DARK.surface0) > contrastRatio(dark.ansi[1], DARK.surface0), "bright red is lighter on a dark theme");
  const light = makePalette(LIGHT);
  assert.ok(contrastRatio(light.ansi[9], LIGHT.surface2) > contrastRatio(light.ansi[1], LIGHT.surface2), "bright red is darker on a light theme");
  assert.equal(light.ansi[4], "#2563eb");
  assert.equal(dark.ansi[4], "#60a5fa");
});

test("attributes map to style flags, inverse swaps before the guard, and dim mixes toward the well", () => {
  const p = makePalette(DARK);
  assert.deepEqual(p.style("1;3;4;9"), { fg: null, bg: null, bold: true, dim: false, italic: true, underline: true, strike: true, hidden: false });
  const inverse = p.style("7;32");
  assert.equal(inverse.bg, DARK.statusSuccess);
  assert.ok(contrastRatio(inverse.fg!, inverse.bg!) >= MIN_CONTRAST);
  const dim = p.style("2");
  assert.ok(dim.fg !== null && contrastRatio(dim.fg, p.well) < contrastRatio(p.text, p.well), "dim text is quieter than plain text");
  assert.ok(contrastRatio(dim.fg!, p.well) >= MIN_CONTRAST);
  assert.equal(p.style("31"), p.style("31"), "memoized");
});

test("256-color and truecolor values are honored and then guarded: navy on a dark well is lifted", () => {
  const dark = makePalette(DARK);
  assert.equal(makePalette(LIGHT).style("38;2;255;0;0").fg !== "#ff0000" || contrastRatio("#ff0000", makePalette(LIGHT).well) >= MIN_CONTRAST, true);
  const navy = dark.style("38;2;0;0;128").fg!;
  assert.notEqual(navy, "#000080");
  assert.ok(contrastRatio(navy, dark.well) >= MIN_CONTRAST);
  assert.equal(dark.style("38;5;231").fg, "#ffffff");
  assert.equal(dark.style("38;5;16").fg !== "#000000", true, "cube black is lifted on a dark well");
  assert.equal(dark.style("38;5;244").fg, "#808080");
});

test("jest-style badges stay legible: black on green, white on red", () => {
  for (const theme of [LIGHT, DARK]) {
    const p = makePalette(theme);
    const pass = p.style("30;42");
    const fail = p.style("37;41");
    assert.ok(contrastRatio(pass.fg!, pass.bg!) >= MIN_CONTRAST);
    assert.ok(contrastRatio(fail.fg!, fail.bg!) >= MIN_CONTRAST);
  }
});

test("garbage theme colors fall back to a fixed palette instead of throwing", () => {
  const p = makePalette({ ...DARK, surface0: "not a color", statusDanger: "" });
  assert.equal(typeof p.well, "string");
  assert.equal(p.ansi.length, 16);
  assert.doesNotThrow(() => p.style("31;1"));
  assert.equal(isLight({ ...DARK, surface0: "hsl(1 2 3)" }), null);
  assert.equal(isLight(LIGHT), true);
  assert.equal(isLight(DARK), false);
});

test("ensureContrast keeps a readable color, nudges an unreadable one, and falls back when nothing helps", () => {
  assert.equal(ensureContrast("#ffffff", "#000000", 3.5, ["#000000", "#ffffff"]), "#ffffff");
  const lifted = ensureContrast("#202040", "#18181b", 3.5, ["#18181b", "#fafafa"]);
  assert.ok(contrastRatio(lifted, "#18181b") >= 3.5);
  assert.equal(ensureContrast("#808080", "#808080", 21, ["#000000", "#ffffff"]), "#000000");
});
