import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { act, createContext, useContext, useState } from "react";
import { create } from "react-test-renderer";
import { clientHarness } from "../../test-support/client-harness.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("clicks inside the portaled dialog do not rerun the composer action or reload history", async () => {
  const Open = createContext(false);
  let reads = 0;
  let pillPresses = 0;
  const native = Object.fromEntries(["View", "Text", "Pressable", "ActivityIndicator"].map((name) => [name, name]));
  const Modal = Object.assign(({ open, children }) => React.createElement(Open.Provider, { value: open }, children), {
    Content: ({ children }) => useContext(Open) ? React.createElement("dialog", null, children) : null,
  });
  const rpc = async () => {
    reads++;
    const text = JSON.stringify({ type: "user", message: { role: "user", content: "Visible message" } }) + "\n";
    return { path: "/tmp/log.jsonl", source: "one", provider: "claude", text, offset: 0,
      nextOffset: text.length, totalBytes: text.length, modifiedAt: "2026-09-13" };
  };
  const h = clientHarness(fileURLToPath(new URL("..", import.meta.url)), {
    "react-native": { ...native, Platform: { OS: "web" } },
    "@getpaseo/plugin/client": { useRpc: () => rpc },
    "@getpaseo/plugin/client/react-native": {
      Modal, ScrollView: "ScrollView", Icon: "Icon", copyText: async () => {},
      FlatList: ({ data, renderItem }) => React.createElement("list", null, data.map((item, index) =>
        React.createElement(React.Fragment, { key: index }, renderItem({ item, index })))),
    },
  });
  const stop = h.load("index.client.tsx").default(h.client);
  h.agents.bootstrap([{ agent: { id: "a", workspaceId: "w" } }]); await h.flush();
  const button = h.registrations[0].button;
  let pendingAction: Promise<void> | undefined;
  function Host() {
    const [pending, setPending] = useState(false);
    return React.createElement("pill", {
      onClick: () => {
        // Paseo's PluginButtonStore.run always marks actions pending, and
        // ButtonView replaces the custom-icon subtree with a spinner.
        pillPresses++; setPending(true);
        pendingAction = Promise.resolve(button.behavior.onPress()).finally(() => setPending(false));
      },
    }, pending ? React.createElement("spinner") : React.createElement(button.icon, {
      context: "agent", agentId: "a", workspaceId: "w", size: 14, color: "gray",
      host: { id: "host", label: "Host" }, layout: { platform: "web", compact: false },
      theme: { colors: {} },
    }));
  }
  let renderer;
  await act(async () => { renderer = create(React.createElement(Host)); });
  await act(async () => { button.behavior.onPress(); });
  assert.equal(reads, 1);

  // React portals retain the logical React ancestry. Bubble a click from the
  // dialog content through the real plugin tree to the host pill.
  const message = renderer.root.findAllByType("Text").find((item) => item.props.children === "Visible message");
  assert.ok(message);
  let stopped = false;
  const event = { stopPropagation: () => { stopped = true; } };
  act(() => {
    for (let node = message; node && !stopped; node = node.parent) {
      if (typeof node.type === "string") node.props.onClick?.(event);
    }
  });
  await act(async () => { await pendingAction; });
  assert.deepEqual({ pillPresses, reads }, { pillPresses: 0, reads: 1 });

  const sourceButton = renderer.root.findAllByType("Pressable").find((item) => item.props.accessibilityLabel === "Raw source");
  assert.ok(sourceButton);
  stopped = false;
  act(() => {
    sourceButton.props.onPress();
    for (let node = sourceButton; node && !stopped; node = node.parent) {
      if (typeof node.type === "string") node.props.onClick?.(event);
    }
  });
  await act(async () => { await pendingAction; });
  assert.ok(renderer.root.findAllByType("Text").some((item) => item.props.children === "/tmp/log.jsonl"));
  const results = { pillPresses, reads };
  await act(async () => { renderer.unmount(); stop(); });
  assert.deepEqual(results, { pillPresses: 0, reads: 1 });
});
