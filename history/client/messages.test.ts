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
