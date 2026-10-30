import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { clientHarness } from "../../test-support/client-harness.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderViewer() {
  const reply = "**Found it.**\n\n<oai-mem-citation>MEMORY.md: PRIVATE_METADATA</oai-mem-citation>";
  const text = [{ type: "user", message: { role: "user", content: "Why is the total off?" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: reply }] } }]
    .map((record) => JSON.stringify(record)).join("\n") + "\n";
  const h = clientHarness(fileURLToPath(new URL("..", import.meta.url)), {
    "react-native": { View: "View", Text: "Text", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", Platform: { OS: "web" } },
    "@getpaseo/plugin/client": { useRpc: () => async () =>
      ({ path: "/tmp/log", source: "one", provider: "claude", text, offset: 0, nextOffset: text.length, totalBytes: text.length }) },
    "@getpaseo/plugin/client/ui": { Icon: "Icon", Markdown: "Markdown", copyText: async () => {}, FlatList: "list", ScrollView: "scroll" },
  });
  return create(React.createElement(h.load("client/viewer.tsx").HistoryViewer, { agentId: "a", theme: { colors: {} } }));
}

test("draws messages with Paseo's Markdown and hides memory citations", async () => {
  let renderer;
  await act(async () => { renderer = renderViewer(); });
  assert.deepEqual(renderer.root.findAllByType("Markdown").map((node) => node.props.children), ["Why is the total off?", "**Found it.**"]);
  assert.ok(!JSON.stringify(renderer.toJSON()).includes("PRIVATE_METADATA"));
  await act(async () => renderer.unmount());
});

test("tells screen readers on the web which toggles are on and whether a record is expanded", async () => {
  let renderer;
  await act(async () => { renderer = renderViewer(); });
  const raw = () => renderer.root.findAllByType("Pressable").find((node) => node.props.accessibilityLabel === "Raw turn entries");
  assert.equal(raw().props["aria-selected"], false);
  assert.equal(raw().props["aria-pressed"], false);
  act(() => raw().props.onPress());
  assert.equal(raw().props["aria-selected"], true);
  assert.equal(raw().props["aria-pressed"], true);
  const copy = renderer.root.findAllByType("Pressable").find((node) => node.props.accessibilityLabel === "Copy message");
  assert.equal(copy.props["aria-pressed"], undefined, "a plain button is not a toggle");
  const expand = () => renderer.root.findAllByType("Pressable").find((node) => /^Expand /.test(node.props.accessibilityLabel));
  assert.equal(expand().props["aria-expanded"], false);
  act(() => expand().props.onPress());
  assert.equal(renderer.root.findAllByType("Pressable").find((node) => /^Collapse /.test(node.props.accessibilityLabel)).props["aria-expanded"], true);
  await act(async () => renderer.unmount());
});
