import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));
const MB = 1024 * 1024;

type Element = { type: unknown; props: Record<string, any> };

function renderTab(size: number, platform: "web" | "ios") {
  let messages: unknown;
  const reads: unknown[] = [];
  const DocumentFrame = () => null;
  const Loading = () => null;
  const h = clientHarness(directory, {
    react: { ...React, useContext: () => ({ locale: "en", messages }) },
    "react-native": { Platform: { OS: platform }, View: "View", Text: "Text" },
    "@getpaseo/plugin/client": { useFileUrl: (file: unknown) => { reads.push(file); return { status: "ready", url: "blob:spec" }; } },
    "@getpaseo/plugin/client/ui": { DocumentFrame, Loading },
  });
  messages = h.load("client/i18n.ts").messagesFor("en");
  const { PdfPanel } = h.load("client/pdf.tsx");
  const expand = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object") return node;
    const element = node as Element;
    if (typeof element.type === "function" && element.type !== DocumentFrame && element.type !== Loading) return expand((element.type as (props: unknown) => unknown)(element.props));
    return { ...element, props: { ...element.props, children: expand(element.props?.children) } };
  };
  const file = { name: "spec.pdf", path: "/w/spec.pdf", size };
  const drawn = expand(PdfPanel({ file, layout: { platform, compact: false }, theme: { colors: { foregroundMuted: "#888888", statusDanger: "#ff0000" } } }));
  const find = (node: unknown, type: unknown): Element | undefined => {
    if (Array.isArray(node)) return node.map((child) => find(child, type)).find(Boolean);
    if (!node || typeof node !== "object") return undefined;
    return (node as Element).type === type ? node as Element : find((node as Element).props?.children, type);
  };
  const text = (node: unknown): string[] => {
    if (typeof node === "string") return [node];
    if (Array.isArray(node)) return node.flatMap(text);
    return node && typeof node === "object" ? text((node as Element).props?.children) : [];
  };
  return { reads, frame: find(drawn, DocumentFrame), text: text(drawn) };
}

test("a PDF tab under the limit is read and drawn", () => {
  const tab = renderTab(30 * MB, "web");
  assert.equal(tab.reads.length, 1);
  assert.equal(tab.frame?.props.url, "blob:spec");
});

test("a PDF tab over the limit says so and reads nothing", () => {
  const tab = renderTab(140 * MB, "web");
  assert.deepEqual(tab.text, ["This PDF is 140 MB, too large to show here."]);
  assert.equal(tab.reads.length, 0);
  assert.equal(tab.frame, undefined);
});

test("a phone has a lower PDF limit than the desktop app", () => {
  assert.equal(renderTab(30 * MB, "ios").reads.length, 0, "30 MB is too much to pull over a phone's link");
  assert.equal(renderTab(20 * MB, "ios").reads.length, 1);
});
