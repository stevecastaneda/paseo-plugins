import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));

type Element = { type: unknown; props: Record<string, any> };

function find(node: unknown, matches: (element: Element) => boolean): Element | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) return node.map((child) => find(child, matches)).find(Boolean);
  const element = node as Element;
  return matches(element) ? element : find(element.props?.children, matches);
}

function renderWriteUp(data: unknown, path: string, all = false) {
  let messages: unknown;
  const Markdown = () => null;
  const h = clientHarness(directory, {
    react: { ...React, useState: () => [all, () => {}], useMemo: (make: () => unknown) => make(), useContext: () => ({ locale: "en", messages }) },
    "react-native": { Platform: { OS: "web" }, View: "View", Text: "Text" },
    "@tanstack/react-query": { useQuery: () => ({ data }) },
    "@getpaseo/plugin/client": { useRpc: () => async () => ({}) },
    "@getpaseo/plugin/client/ui": { Icon: () => null, Markdown },
  });
  messages = h.load("client/i18n.ts").messagesFor("en");
  const { WriteUp } = h.load("client/write-up.tsx");
  const drawn = WriteUp({ colors: {}, source: { ref: "T01.source", title: path, path }, workspaceId: "w", workspaceDirectory: "/w", onOpen() {} });
  return {
    markdown: find(drawn, (element) => element.type === Markdown)?.props.children as string | undefined,
    text: find(drawn, (element) => element.type === "Text" && element.props.selectable === true)?.props.children as string | undefined,
    readMore: find(drawn, (element) => element.props?.label === "Read more" || element.props?.label === "Show less")?.props.label as string | undefined,
  };
}

const spec = "# Login\n\n## Goal\n\nSign in by email.\n\n```md\n# not a heading\n```\n\n" + "More detail. ".repeat(40);

test("a Markdown write-up draws its excerpt with Paseo's Markdown, headings small and the title gone", () => {
  const excerpt = renderWriteUp({ kind: "markdown", markdown: spec, bytes: spec.length, truncated: false }, "specs/login.md");
  assert.equal(excerpt.markdown, "##### Goal\n\nSign in by email.\n\n```md\n# not a heading\n```");
  assert.equal(excerpt.readMore, "Read more");
  const whole = renderWriteUp({ kind: "markdown", markdown: spec, bytes: spec.length, truncated: false }, "specs/login.md", true);
  assert.equal(whole.markdown, spec.replace("# Login\n\n## Goal", "##### Goal"));
  assert.equal(whole.readMore, "Show less");
});

test("a plain-text write-up keeps its lines as written", () => {
  const notes = "First line\nSecond line\n";
  const drawn = renderWriteUp({ kind: "text", text: notes, bytes: notes.length, truncated: false }, "specs/login.txt");
  assert.equal(drawn.markdown, undefined);
  assert.equal(drawn.text, "First line\nSecond line");
  assert.equal(drawn.readMore, undefined);
});
