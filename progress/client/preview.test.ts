import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));

type Element = { type: unknown; props: Record<string, any> };

// Renders the full-screen layer of an image preview in a 1200x800 window, by calling
// the components, and returns the text it shows.
function fullScreenText(image: { width: number; height: number }): string[] {
  let messages: unknown;
  const h = clientHarness(directory, {
    react: { ...React, useState: (initial: unknown) => [initial, () => {}], useRef: (current: unknown) => ({ current }), useEffect() {}, useContext: () => ({ locale: "en", messages }) },
    "react-native": { Platform: { OS: "web" }, useWindowDimensions: () => ({ width: 1200, height: 800 }) },
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useQuery: () => ({ data: { kind: "image", dataUri: "data:image/png;base64,", width: image.width, ratio: image.width / image.height }, isPlaceholderData: false }),
    },
    "@getpaseo/plugin/client": { useRpc: () => async () => ({}) },
    "@getpaseo/plugin/client/react-native": { Icon: () => null, ScrollView: () => null, useToast: () => ({}), copyText: async () => {} },
  });
  messages = h.load("client/i18n.ts").messagesFor("en");
  const { PreviewContent } = h.load("client/preview.tsx");
  const shot = { ref: "shot", title: "Shot", path: "shot.png" };
  const preview = PreviewContent({ colors: { surface0: "#000000", surface1: "#000000" }, attachment: shot, workspaceId: "w", workspaceDirectory: "/w", fullScreen: true,
    onFullScreen() {}, onLong() {}, onOpenOnHost() {}, onCopyPath() {}, onOpenEntry() {} });
  const find = (node: unknown): Element | undefined => {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node)) return node.map(find).find(Boolean);
    const element = node as Element;
    return "onExit" in (element.props ?? {}) ? element : find(element.props?.children);
  };
  const layer = find(preview)!;
  const text = (node: unknown): string[] => {
    if (typeof node === "string") return [node];
    if (Array.isArray(node)) return node.flatMap(text);
    return node && typeof node === "object" ? text((node as Element).props?.children) : [];
  };
  return text((layer.type as (props: unknown) => unknown)(layer.props));
}

test("full screen offers Fit to width only for an image too long to read whole", () => {
  assert.ok(fullScreenText({ width: 1170, height: 6000 }).includes("Fit to width"));
  assert.ok(!fullScreenText({ width: 1600, height: 900 }).includes("Fit to width"));
});
