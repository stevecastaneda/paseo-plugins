import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { act, useImperativeHandle } from "react";
import { create } from "react-test-renderer";
import { clientHarness } from "../../test-support/client-harness.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function mount(roles) {
  const jumps = [];
  const stats = { reads: 0 };
  const text = roles.map((role, index) => JSON.stringify({ type: role,
    message: { role, content: `Message ${index}` } })).join("\n") + "\n";
  const h = clientHarness(fileURLToPath(new URL("..", import.meta.url)), {
    "react-native": { View: "View", Text: "Text", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", Platform: { OS: "web" } },
    "@getpaseo/plugin/client": { useRpc: () => async () => {
      stats.reads++;
      return { path: "/tmp/log", source: "one", provider: "claude", text, offset: 0, nextOffset: text.length, totalBytes: text.length };
    } },
    "@getpaseo/plugin/client/ui": {
      Icon: "Icon", Markdown: "Markdown", copyText: async () => {}, FlatList: "list",
      ScrollView: ({ ref, ...props }) => {
        useImperativeHandle(ref, () => ({ scrollTo: args => jumps.push(args) }));
        return React.createElement("scroll", props, props.children);
      },
    },
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.load("client/viewer.tsx").HistoryViewer, { agentId: "a", theme: { colors: {} } })); });
  const button = label => renderer.root.findAllByType("Pressable").find(node => node.props.accessibilityLabel === label);
  const scroller = () => renderer.root.findByType("scroll");
  return {
    renderer, jumps, stats, button,
    layoutTurns(offsets) {
      const nodes = renderer.root.findAllByType("View").filter(node => node.props.onLayout);
      act(() => nodes.forEach((node, index) => node.props.onLayout({ nativeEvent: { layout: { y: offsets[index] } } })));
    },
    size(viewport, content) {
      act(() => {
        scroller().props.onLayout({ nativeEvent: { layout: { height: viewport } } });
        scroller().props.onContentSizeChange(400, content);
      });
    },
    scroll(y) { act(() => scroller().props.onScroll({ nativeEvent: { contentOffset: { y } } })); },
    press(label) { act(() => button(label).props.onPress()); },
    // No scroll events for as long as the viewer waits: whatever was scrolling has stopped.
    quiet() {
      act(() => [...h.timers].forEach(([id, timer]) => { h.timers.delete(id); timer.callback(); }));
    },
    arrows: () => ({ previous: !button("Previous turn").props.disabled, next: !button("Next turn").props.disabled }),
    unmount: () => act(async () => renderer.unmount()),
  };
}

const fourTurns = ["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant"];

test("footer arrows navigate turns without replacing the conversation", async () => {
  const v = await mount(["user", "assistant", "user"]);
  // Two turn anchors; the assistant message belongs to the first turn.
  v.layoutTurns([0, 1100]);
  v.size(600, 1700);
  assert.equal(v.button("Previous turn").props.disabled, true);
  v.press("Next turn");
  assert.equal(v.jumps[0].y, 1100);
  v.scroll(1100);
  assert.equal(v.button("Next turn").props.disabled, true);
  v.press("Previous turn");
  assert.equal(v.jumps[1].y, 0);
  assert.equal(v.stats.reads, 1);
  assert.equal(v.renderer.root.findAllByType("Markdown").filter(node => /^Message \d$/.test(node.props.children)).length, 3);
  v.press("Raw source");
  assert.equal(v.button("Next turn"), undefined);
  v.press("Conversation");
  assert.equal(v.button("Previous turn").props.disabled, true);
  v.size(600, 1300);
  v.scroll(700);
  assert.equal(v.button("Next turn").props.disabled, true, "scrolled to the end, the last turn is current");
  assert.equal(v.button("Previous turn").props.disabled, false);
  v.scroll(0);
  v.press("Next turn");
  assert.equal(v.jumps.at(-1).y, 700); // Last short turn cannot reach the viewport top.
  v.scroll(700);
  assert.equal(v.button("Next turn").props.disabled, true);
  assert.equal(v.button("Previous turn").props.disabled, false);
  v.press("Previous turn");
  assert.equal(v.jumps.at(-1).y, 0);
  await v.unmount();
});

test("both arrows are off in a chat that doesn't scroll", async () => {
  const v = await mount(["user", "assistant", "user", "assistant", "user", "assistant"]);
  v.layoutTurns([0, 120, 240]);
  v.size(600, 400);
  assert.deepEqual(v.arrows(), { previous: false, next: false });
  await v.unmount();
});

test("arriving at the end by Next turns Next off", async () => {
  const v = await mount(fourTurns);
  // The last two turns are short, so both stop at the end of the chat (1400).
  v.layoutTurns([0, 1000, 1500, 1700]);
  v.size(600, 2000);
  v.scroll(1000);
  v.press("Next turn");
  assert.equal(v.jumps.at(-1).y, 1400);
  v.scroll(1400);
  assert.deepEqual(v.arrows(), { previous: true, next: false });
  await v.unmount();
});

test("Previous from the end moves up to the turn above", async () => {
  const v = await mount(fourTurns);
  v.layoutTurns([0, 1000, 1500, 1700]);
  v.size(600, 2000);
  v.scroll(1400);
  assert.deepEqual(v.arrows(), { previous: true, next: false });
  v.press("Previous turn");
  assert.equal(v.jumps.at(-1).y, 1000);
  await v.unmount();
});

test("a double press moves two turns while the first jump is still scrolling", async () => {
  const v = await mount(fourTurns);
  v.layoutTurns([0, 1000, 1500, 1700]);
  v.size(600, 2000);
  v.press("Next turn");
  v.scroll(400);
  v.press("Next turn");
  assert.deepEqual(v.jumps.map(jump => jump.y), [1000, 1400]);
  assert.deepEqual(v.arrows(), { previous: true, next: false }, "Next is off as soon as the end is the destination");
  v.scroll(900);
  v.scroll(1400);
  assert.deepEqual(v.arrows(), { previous: true, next: false });
  await v.unmount();
});

test("scrolling by hand during a jump moves the arrows with the view", async () => {
  const v = await mount(fourTurns);
  v.layoutTurns([0, 1000, 1500, 1700]);
  v.size(600, 2000);
  v.press("Next turn");
  v.scroll(400);
  v.scroll(100);
  v.quiet();
  v.press("Next turn");
  assert.equal(v.jumps.at(-1).y, 1000, "the next press starts from where the user left the view");
  await v.unmount();
});

test("both arrows are off before the scroll area has its size", async () => {
  const v = await mount(fourTurns);
  v.layoutTurns([0, 1000, 1500, 1700]);
  assert.deepEqual(v.arrows(), { previous: false, next: false });
  v.size(600, 2000);
  assert.deepEqual(v.arrows(), { previous: false, next: true });
  await v.unmount();
});

test("a jump that stops short counts from the view once scrolling goes quiet", async () => {
  const v = await mount(fourTurns);
  v.layoutTurns([0, 1000, 1500, 1700]);
  v.size(600, 2000);
  v.scroll(1000);
  v.press("Next turn");
  assert.equal(v.jumps.at(-1).y, 1400);
  // Caught partway: the view stops at 1200 without passing the target or turning back.
  v.scroll(1100);
  v.scroll(1200);
  v.quiet();
  assert.deepEqual(v.arrows(), { previous: true, next: true }, "the end is still below the view");
  v.press("Next turn");
  assert.equal(v.jumps.at(-1).y, 1400);
  v.scroll(1400);
  v.quiet();
  v.press("Previous turn");
  assert.equal(v.jumps.at(-1).y, 1000);
  await v.unmount();
});

test("a jump re-aims when the end of the chat moves up under it", async () => {
  const v = await mount(fourTurns);
  v.layoutTurns([0, 1000, 1500, 1700]);
  v.size(600, 2000);
  v.scroll(1000);
  v.press("Next turn");
  assert.equal(v.jumps.at(-1).y, 1400);
  v.scroll(1100);
  // The window grows, so the end of the chat is now at 1200 and the view stops there.
  v.size(800, 2000);
  v.scroll(1200);
  assert.deepEqual(v.arrows(), { previous: true, next: false });
  v.press("Previous turn");
  assert.equal(v.jumps.at(-1).y, 1000, "Previous moves up instead of re-aiming at the end");
  await v.unmount();
});

test("reversing during a jump keeps counting from the new destination", async () => {
  const v = await mount(fourTurns);
  v.layoutTurns([0, 1000, 1500, 1700]);
  v.size(600, 2000);
  v.scroll(1000);
  v.press("Next turn");
  v.scroll(1100);
  v.press("Previous turn");
  // One more event from the first jump, still heading down.
  v.scroll(1120);
  v.press("Previous turn");
  assert.deepEqual(v.jumps.map(jump => jump.y), [1400, 1000, 0]);
  await v.unmount();
});
