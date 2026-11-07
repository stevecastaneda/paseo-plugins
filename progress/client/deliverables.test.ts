import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));

type Element = { type: unknown; props: Record<string, any> };

const Markdown = () => null;
const deliverable = (id: string, path: string) => ({ id, title: id, path, kind: "file", addedAt: "2026-10-30T00:00:00Z" });

function linkTargets(platform: string, deliverables = [deliverable("D1", "docs/My spec (v2).pdf"), deliverable("D2", "docs/notes.md")]): string[] {
  let messages: unknown;
  const h = clientHarness(directory, {
    react: { ...React, useState: (initial: unknown) => [initial, () => {}], useContext: () => ({ locale: "en", messages }) },
    "react-native": { Platform: { OS: platform }, View: "View", Text: "Text" },
    "@getpaseo/plugin/client": { useRpc: () => async () => ({}) },
    "@getpaseo/plugin/client/ui": { Icon: () => null, Markdown, useToast: () => ({}), copyText: async () => {} },
  });
  messages = h.load("client/i18n.ts").messagesFor("en");
  const { DeliverablesList } = h.load("client/deliverables.tsx");
  const drawn = DeliverablesList({
    colors: {},
    now: Date.parse("2026-10-30T01:00:00Z"),
    workspaceId: "w",
    workspaceDirectory: "/repo",
    deliverables,
  });
  const links: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const element = node as Element;
    if (element.type === Markdown) links.push(element.props.children.replace(/^\[[^\]]*\]\((.*)\)$/, "$1"));
    if (typeof element.type === "function" && ("target" in element.props || "link" in element.props))
      walk((element.type as (props: unknown) => unknown)(element.props));
    walk(element.props?.children);
  };
  walk(drawn);
  return links;
}

test("a PDF deliverable's tab button opens its full path, on iPhone, iPad and desktop", () => {
  assert.deepEqual(linkTargets("ios"), ["/repo/docs/My%20spec%20%28v2%29.pdf"]);
  assert.deepEqual(linkTargets("web"), ["/repo/docs/My%20spec%20%28v2%29.pdf"]);
});

test("Android draws no tab button", () => {
  assert.deepEqual(linkTargets("android"), []);
});

test("an HTML deliverable's row links to its full path, so pressing it opens Paseo's preview in a tab on desktop and phones", () => {
  for (const platform of ["web", "ios", "android"]) {
    assert.deepEqual(linkTargets(platform, [deliverable("D1", "report/My report.html")]), ["/repo/report/My%20report.html"], platform);
  }
});

test("in a browser a page row's press clicks its hidden link once, and the click it sends back to the row is no second press", () => {
  const h = clientHarness(directory, {
    "react-native": { Platform: { OS: "web" }, View: "View", Text: "Text" },
    "@getpaseo/plugin/client": { useRpc: () => async () => ({}) },
    "@getpaseo/plugin/client/ui": { Icon: () => null, Markdown, useToast: () => ({}), copyText: async () => {} },
  });
  const { followPageLink } = h.load("client/attachments.tsx");
  let clicks = 0;
  const echoes: boolean[] = [];
  const link = {
    current: {
      querySelector: (selector: string) =>
        selector === "a"
          ? {
              click() {
                clicks++;
                echoes.push(followPageLink(link));
              },
            }
          : null,
    },
  };
  assert.equal(followPageLink(link), true);
  assert.equal(clicks, 1);
  assert.deepEqual(echoes, [false]);
});
