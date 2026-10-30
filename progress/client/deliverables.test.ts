import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));

type Element = { type: unknown; props: Record<string, any> };

function tabTargets(platform: string): string[] {
  let messages: unknown;
  const Markdown = () => null;
  const h = clientHarness(directory, {
    react: { ...React, useState: (initial: unknown) => [initial, () => {}], useContext: () => ({ locale: "en", messages }) },
    "react-native": { Platform: { OS: platform }, View: "View", Text: "Text" },
    "@getpaseo/plugin/client": { useRpc: () => async () => ({}) },
    "@getpaseo/plugin/client/ui": { Icon: () => null, Markdown, useToast: () => ({}), copyText: async () => {} },
  });
  messages = h.load("client/i18n.ts").messagesFor("en");
  const { DeliverablesList } = h.load("client/deliverables.tsx");
  const deliverable = (id: string, path: string) => ({ id, title: id, path, kind: "file", addedAt: "2026-10-30T00:00:00Z" });
  const drawn = DeliverablesList({ colors: {}, now: Date.parse("2026-10-30T01:00:00Z"), workspaceId: "w", workspaceDirectory: "/repo",
    deliverables: [deliverable("D1", "docs/My spec (v2).pdf"), deliverable("D2", "docs/notes.md")] });
  const links: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const element = node as Element;
    if (element.type === Markdown) links.push(element.props.children.replace(/^\[[^\]]*\]\((.*)\)$/, "$1"));
    if (typeof element.type === "function" && "target" in element.props) walk((element.type as (props: unknown) => unknown)(element.props));
    walk(element.props?.children);
  };
  walk(drawn);
  return links;
}

test("a PDF deliverable's tab button opens its full path, on iPhone, iPad and desktop", () => {
  assert.deepEqual(tabTargets("ios"), ["/repo/docs/My%20spec%20%28v2%29.pdf"]);
  assert.deepEqual(tabTargets("web"), ["/repo/docs/My%20spec%20%28v2%29.pdf"]);
});

test("Android draws no tab button", () => {
  assert.deepEqual(tabTargets("android"), []);
});
