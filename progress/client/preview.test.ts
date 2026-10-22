import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));

type Element = { type: unknown; props: Record<string, any> };
type Query = { data?: unknown; error?: unknown; isPending?: boolean; isPlaceholderData?: boolean };

// Renders a full-screen image preview in a 1200x800 window by calling the
// component, with its effects run once. Returns the full-screen layer, if
// drawn, and what the preview asked full screen to become.
function renderFullScreen(query: Query): { layer: Element | undefined; fullScreenCalls: boolean[] } {
  let messages: unknown;
  const h = clientHarness(directory, {
    react: { ...React, useState: (initial: unknown) => [initial, () => {}], useRef: (current: unknown) => ({ current }), useEffect: (effect: () => void) => effect(),
      useContext: () => ({ locale: "en", messages }) },
    "react-native": { Platform: { OS: "web" }, useWindowDimensions: () => ({ width: 1200, height: 800 }) },
    "@tanstack/react-query": { useQueryClient: () => ({}), useQuery: () => ({ isPending: false, isPlaceholderData: false, ...query }) },
    "@getpaseo/plugin/client": { useRpc: () => async () => ({}) },
    "@getpaseo/plugin/client/react-native": { Icon: () => null, ScrollView: () => null, useToast: () => ({}), copyText: async () => {} },
  });
  messages = h.load("client/i18n.ts").messagesFor("en");
  const { PreviewContent } = h.load("client/preview.tsx");
  const shot = { ref: "shot", title: "Shot", path: "shot.png" };
  const fullScreenCalls: boolean[] = [];
  const preview = PreviewContent({ colors: { surface0: "#000000", surface1: "#000000" }, attachment: shot, workspaceId: "w", workspaceDirectory: "/w", fullScreen: true,
    onFullScreen(on: boolean) { fullScreenCalls.push(on); }, onLong() {}, onOpenOnHost() {}, onCopyPath() {}, onOpenEntry() {} });
  const find = (node: unknown): Element | undefined => {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node)) return node.map(find).find(Boolean);
    const element = node as Element;
    return "onExit" in (element.props ?? {}) ? element : find(element.props?.children);
  };
  return { layer: find(preview), fullScreenCalls };
}

function image(size: { width: number; height: number }) {
  return { kind: "image", dataUri: "data:image/png;base64,", width: size.width, ratio: size.width / size.height };
}

function fullScreenText(size: { width: number; height: number }): string[] {
  const { layer } = renderFullScreen({ data: image(size) });
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
