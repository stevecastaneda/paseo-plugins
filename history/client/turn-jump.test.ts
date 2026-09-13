import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { act, useImperativeHandle } from "react";
import { create } from "react-test-renderer";
import { clientHarness } from "../../test-support/client-harness.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("footer arrows navigate turns without replacing the conversation", async () => {
  const jumps = [];
  let reads = 0;
  const text = ["user", "assistant", "user"].map((role, index) => JSON.stringify({ type: role,
    message: { role, content: `Message ${index}` } })).join("\n") + "\n";
  const h = clientHarness(fileURLToPath(new URL("..", import.meta.url)), {
    "react-native": { View: "View", Text: "Text", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", Platform: { OS: "web" } },
    "@getpaseo/plugin/client": { useRpc: () => async () => {
      reads++;
      return { path: "/tmp/log", source: "one", provider: "claude", text, offset: 0, nextOffset: text.length, totalBytes: text.length };
    } },
    "@getpaseo/plugin/client/react-native": {
      Icon: "Icon", copyText: async () => {}, FlatList: "list",
      ScrollView: ({ ref, ...props }) => {
        useImperativeHandle(ref, () => ({ scrollTo: args => jumps.push(args) }));
        return React.createElement("scroll", props, props.children);
      },
    },
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.load("client/viewer.tsx").HistoryViewer, { agentId: "a", theme: { colors: {} } })); });
  const button = label => renderer.root.findAllByType("Pressable").find(node => node.props.accessibilityLabel === label);
  const layoutNodes = renderer.root.findAllByType("View").filter(node => node.props.onLayout);
  // Two turn anchors; the assistant message belongs to the first turn.
  act(() => layoutNodes.forEach((node, index) => node.props.onLayout({ nativeEvent: { layout: { y: [0, 1100][index] } } })));
  assert.equal(button("Previous turn").props.disabled, true);
  act(() => button("Next turn").props.onPress());
  assert.equal(jumps[0].y, 1100);
  act(() => renderer.root.findByType("scroll").props.onScroll({ nativeEvent: { contentOffset: { y: 1100 } } }));
  assert.equal(button("Next turn").props.disabled, true);
  act(() => button("Previous turn").props.onPress());
  assert.equal(jumps[1].y, 0);
  assert.equal(reads, 1);
  assert.equal(renderer.root.findAllByType("Text").filter(node => /^Message \d$/.test(node.props.children)).length, 3);
  act(() => button("Raw source").props.onPress());
  assert.equal(button("Next turn"), undefined);
  act(() => button("Conversation").props.onPress());
  assert.equal(button("Previous turn").props.disabled, true);
  const scroller = renderer.root.findByType("scroll");
  act(() => {
    scroller.props.onLayout({ nativeEvent: { layout: { height: 600 } } });
    scroller.props.onContentSizeChange(400, 1300);
  });
  act(() => button("Next turn").props.onPress());
  assert.equal(jumps.at(-1).y, 700); // Last short turn cannot reach the viewport top.
  act(() => scroller.props.onScroll({ nativeEvent: { contentOffset: { y: 700 } } }));
  assert.equal(button("Next turn").props.disabled, true);
  assert.equal(button("Previous turn").props.disabled, false);
  act(() => button("Previous turn").props.onPress());
  assert.equal(jumps.at(-1).y, 0);
  await act(async () => renderer.unmount());
});
