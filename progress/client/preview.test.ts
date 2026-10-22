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
    react: { ...React, useState: (initial: unknown) => [initial, () => {}], useRef: (current: unknown) => ({ current }), useEffect: (effect: () => void) => effect(),
      useContext: () => ({ locale: "en", messages }) },
    "react-native": { Platform: { OS: "web" }, useWindowDimensions: () => window },
    "@tanstack/react-query": { useQueryClient: () => ({}), useQuery: () => ({ isPending: false, isPlaceholderData: false, ...query }) },
    "@getpaseo/plugin/client": { useRpc: () => async () => ({}) },
    "@getpaseo/plugin/client/react-native": { Icon: () => null, ScrollView: () => null, useToast: () => ({}), copyText: async () => {} },
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
