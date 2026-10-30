import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));

type Element = { type: unknown; props: Record<string, any> };
type Query = { data?: unknown; error?: unknown; isPending?: boolean; isPlaceholderData?: boolean };

type Window = { width: number; height: number };

// Renders an image preview, in full screen unless told otherwise, by calling the
// component with its effects run once. Returns what it drew, the full-screen
// layer if drawn, and what the preview asked full screen to become.
function renderPreview(query: Query, { window = { width: 1200, height: 800 }, fullScreen = true, leftFullScreen = false }: { window?: Window; fullScreen?: boolean; leftFullScreen?: boolean } = {}): { preview: unknown; layer: Element | undefined; fullScreenCalls: boolean[] } {
  let messages: unknown;
  const h = clientHarness(directory, {
    react: { ...React, useState: (initial: unknown) => [initial, () => {}], useRef: (current: unknown) => ({ current }), useEffect: (effect: () => void) => effect(), useMemo: (make: () => unknown) => make(),
      useContext: () => ({ locale: "en", messages }) },
    "react-native": { Platform: { OS: "web" }, useWindowDimensions: () => window },
    "@tanstack/react-query": { useQueryClient: () => ({}), useQuery: () => ({ isPending: false, isPlaceholderData: false, ...query }) },
    "@getpaseo/plugin/client": { useRpc: () => async () => ({}) },
    "@getpaseo/plugin/client/ui": { Icon: () => null, ScrollView: () => null, useToast: () => ({}), copyText: async () => {} },
  });
  messages = h.load("client/i18n.ts").messagesFor("en");
  const { PreviewContent } = h.load("client/preview.tsx");
  const shot = { ref: "shot", title: "Shot", path: "shot.png" };
  const fullScreenCalls: boolean[] = [];
  const preview = PreviewContent({ colors: { surface0: "#000000", surface1: "#000000" }, attachment: shot, workspaceId: "w", workspaceDirectory: "/w", fullScreen, leftFullScreen,
    onFullScreen(on: boolean) { fullScreenCalls.push(on); }, onLong() {}, onOpenOnHost() {}, onCopyPath() {}, onOpenEntry() {} });
  return { preview, layer: findElement(preview, (props) => "onExit" in props), fullScreenCalls };
}

const renderFullScreen = (query: Query) => renderPreview(query);

function findElement(node: unknown, matches: (props: Record<string, any>) => boolean): Element | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) return node.map((child) => findElement(child, matches)).find(Boolean);
  const element = node as Element;
  return matches(element.props ?? {}) ? element : findElement(element.props?.children, matches);
}

function image(size: { width: number; height: number }, type = "image/png") {
  return { kind: "image", dataUri: `data:${type};base64,`, width: size.width, ratio: size.width / size.height };
}

function fullScreenText(size: { width: number; height: number }, window?: Window): string[] {
  const { layer } = renderPreview({ data: image(size) }, { window });
  const text = (node: unknown): string[] => {
    if (typeof node === "string") return [node];
    if (Array.isArray(node)) return node.flatMap(text);
    return node && typeof node === "object" ? text((node as Element).props?.children) : [];
  };
  return text((layer!.type as (props: unknown) => unknown)(layer!.props));
}

test("full screen offers Fit to width only for an image too long to read whole", () => {
  assert.ok(fullScreenText({ width: 1170, height: 6000 }).includes("Fit to width"));
  assert.ok(!fullScreenText({ width: 1600, height: 900 }).includes("Fit to width"));
  const desktop = { width: 1848, height: 1150 };
  assert.ok(!fullScreenText({ width: 2880, height: 2000 }, desktop).includes("Fit to width"), "a window screenshot");
  assert.ok(fullScreenText({ width: 1170, height: 2532 }, desktop).includes("Fit to width"), "a phone screenshot");
});

test("full screen ends when the image stepped onto fails to load", () => {
  const { layer, fullScreenCalls } = renderFullScreen({ error: new Error("too large to preview") });
  assert.equal(layer, undefined);
  assert.deepEqual(fullScreenCalls, [false]);
});

test("full screen stays on the last image while the next one loads", () => {
  const { layer, fullScreenCalls } = renderFullScreen({ data: image({ width: 1600, height: 900 }), isPlaceholderData: true });
  assert.ok(layer);
  assert.deepEqual(fullScreenCalls, []);
});

// The width the full-screen image is drawn at.
function drawnWidth(data: unknown): number {
  const { layer } = renderFullScreen({ data });
  return findElement((layer!.type as (props: unknown) => unknown)(layer!.props), (props) => "source" in props)!.props.style.width;
}

test("full screen draws a small bitmap at its own pixels, and an SVG as big as the screen allows", () => {
  assert.equal(drawnWidth(image({ width: 24, height: 24 })), 24);
  assert.equal(drawnWidth(image({ width: 24, height: 24 }, "image/svg+xml")), 800 - 48 - 52);
});

// The style on the Full screen button's focusable element, where the focus ring draws.
function fullScreenButtonStyle(options: { fullScreen: boolean; leftFullScreen: boolean }): { outlineWidth?: number } | undefined {
  const { preview } = renderPreview({ data: image({ width: 1600, height: 900 }) }, options);
  return findElement(preview, (props) => props.accessibilityLabel === "Full screen")!.props.outerStyle;
}

test("leaving full screen puts focus back on the Full screen button without a focus ring", () => {
  assert.equal(fullScreenButtonStyle({ fullScreen: false, leftFullScreen: true })?.outlineWidth, 0);
  assert.equal(fullScreenButtonStyle({ fullScreen: false, leftFullScreen: false }), undefined);
});

type MarkdownCase = { markdown: string; truncated?: boolean; hostLong?: boolean; latched?: boolean; stepping?: boolean };

// Renders a Markdown preview in an 800px-tall window, whose dialog has about 459px
// of room. Returns what it drew, what it told the host, and what it latched.
function renderMarkdown({ markdown, truncated = false, hostLong = false, latched = false, stepping = false }: MarkdownCase) {
  let messages: unknown;
  const Markdown = () => null;
  const latches: unknown[] = [];
  const h = clientHarness(directory, {
    react: { ...React, useState: (initial: unknown) => [initial, () => {}], useRef: (current: unknown) => ({ current }), useEffect: (effect: () => void) => effect(),
      useMemo: (make: () => unknown) => make(), useContext: () => ({ locale: "en", messages }) },
    "react-native": { Platform: { OS: "web" }, useWindowDimensions: () => ({ width: 1200, height: 800 }), View: "View", Text: "Text", ActivityIndicator: "ActivityIndicator" },
    "@tanstack/react-query": {
      useQueryClient: () => ({ setQueryData: (key: unknown, value: unknown) => latches.push([key, value]) }),
      useQuery: ({ queryKey }: { queryKey: unknown[] }) => queryKey[1] === "preview-long" ? { data: latched ? true : undefined }
        : queryKey[1] === "preview" ? { isPending: false, isPlaceholderData: stepping, data: { kind: "markdown", markdown, bytes: markdown.length, truncated } } : {},
    },
    "@getpaseo/plugin/client": { useRpc: () => async () => ({}) },
    "@getpaseo/plugin/client/ui": { Icon: () => null, ScrollView: "ScrollView", Markdown, useToast: () => ({}), copyText: async () => {} },
  });
  messages = h.load("client/i18n.ts").messagesFor("en");
  const { PreviewContent, markdownFloor } = h.load("client/preview.tsx");
  const doc = { ref: "D1", title: "Report", path: "docs/report.md" };
  const longCalls: boolean[] = [];
  const preview = PreviewContent({ colors: { surface0: "#000000", surface1: "#000000" }, attachment: doc, workspaceId: "w", workspaceDirectory: "/w", fullScreen: false, leftFullScreen: false,
    hostLong, onFullScreen() {}, onLong(long: boolean) { longCalls.push(long); }, onOpenOnHost() {}, onCopyPath() {}, onOpenEntry() {} });
  return {
    long: longCalls.at(-1),
    markdown: findType(preview, Markdown),
    // The view around the Markdown and its cut-off note.
    wrapper: findElement(preview, (props) => [props.children].flat().some((child) => (child as Element)?.type === Markdown)),
    spinner: findElement(preview, (props) => props.accessibilityLabel === "Loading preview"),
    scrolls: findType(preview, "ScrollView") !== undefined,
    latches: () => JSON.parse(JSON.stringify(latches)),
    markdownFloor: markdownFloor as (markdown: string) => number,
  };
}

function findType(node: unknown, type: unknown): Element | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) return node.map((child) => findType(child, type)).find(Boolean);
  const element = node as Element;
  return element.type === type ? element : findType(element.props?.children, type);
}

const lines = (count: number) => Array.from({ length: count }, (_, index) => `Line ${index + 1}`).join("\n");

test("a short Markdown file draws formatted in the dialog sized to it, and is measured there", () => {
  const short = renderMarkdown({ markdown: "# Report\n\nAll good." });
  assert.equal(short.long, false);
  assert.equal(short.markdown?.props.children, "# Report\n\nAll good.");
  assert.equal(short.scrolls, false);
  assert.equal(typeof short.wrapper?.props.onLayout, "function");
});

test("a Markdown file drawn taller than the dialog latches long; one that fits doesn't", () => {
  const { wrapper, latches } = renderMarkdown({ markdown: lines(30) });
  wrapper!.props.onLayout({ nativeEvent: { layout: { height: 0 } } });
  wrapper!.props.onLayout({ nativeEvent: { layout: { height: 400 } } });
  assert.deepEqual(latches(), [], "Paseo's first empty layout and a height that fits leave it alone");
  wrapper!.props.onLayout({ nativeEvent: { layout: { height: 900 } } });
  assert.deepEqual(latches(), [[["progress", "preview-long", "w", "D1", "docs/report.md"], true]]);
});

test("a latched Markdown file stays long and isn't measured again", () => {
  for (const hostLong of [false, true]) {
    const latched = renderMarkdown({ markdown: lines(30), latched: true, hostLong });
    assert.equal(latched.long, true);
    assert.ok(latched.markdown, "drawn until the host's remount replaces it");
    assert.equal(latched.wrapper?.props.onLayout, undefined);
  }
});

test("a Markdown file too tall for any text size is long at once, and waits for the host's scroll area", () => {
  const waiting = renderMarkdown({ markdown: lines(200) });
  assert.equal(waiting.long, true);
  assert.equal(waiting.markdown, undefined, "not parsed in the dialog it's about to leave");
  assert.ok(waiting.spinner);
  const drawn = renderMarkdown({ markdown: lines(200), hostLong: true });
  assert.equal(drawn.long, true);
  assert.ok(drawn.markdown);
  assert.equal(drawn.scrolls, true);
  assert.equal(drawn.wrapper?.props.onLayout, undefined);
});

test("while stepping, the dimmed Markdown file on screen isn't measured", () => {
  const { wrapper } = renderMarkdown({ markdown: lines(30), stepping: true });
  assert.equal(wrapper?.props.onLayout, undefined);
  assert.equal(wrapper?.props.style.opacity, 0.6);
});

test("a cut Markdown file says so below the Markdown, not inside it", () => {
  const { wrapper, markdown } = renderMarkdown({ markdown: "```\nopen fence", truncated: true });
  const note = [wrapper!.props.children].flat().find((child) => (child as Element)?.type === "Text") as Element;
  assert.match([note.props.children].flat().join(""), /^Showing the first 256 KB\./);
  assert.equal(markdown?.props.children, "```\nopen fence");
});

test("the Markdown floor stays under the real height at Paseo's smallest text sizes", () => {
  const { markdownFloor } = renderMarkdown({ markdown: "" });
  // Paseo 0.13 clamps content text to 10px (drawn at 1.4: 14px lines) and code to 9px
  // (1.45: 13px), so no line draws under 13px.
  const document = ["# Title", "", "Prose", "- item", "1. item", "| a | b |", "```", "code", "```", "> quote"].join("\n");
  const drawnLines = document.split("\n").filter((line) => line.trim()).length;
  assert.ok(markdownFloor(document) <= drawnLines * 13);
});
