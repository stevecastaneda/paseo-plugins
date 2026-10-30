import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));

type Element = { type: unknown; props: Record<string, any> };
type Id = "write-up" | "timeline" | "activity" | "questions" | "deliverables";

const ids: Id[] = ["write-up", "timeline", "activity", "questions", "deliverables"];
// Where each tab lands on a 390pt phone: about 420pt of tabs in a 340pt sheet.
const spans: Record<Id, { x: number; width: number }> = {
  "write-up": { x: 0, width: 62 },
  timeline: { x: 78, width: 78 },
  activity: { x: 172, width: 70 },
  questions: { x: 258, width: 86 },
  deliverables: { x: 360, width: 96 },
};

function strip(overflow: "wrap" | "fit" | "scroll" | undefined, selected: Id) {
  let slots: unknown[] = [];
  let cursor = 0;
  const h = clientHarness(directory, {
    react: { ...React, useEffect() {}, useState(initial: unknown) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
      return [slots[slot], (value: unknown) => { slots[slot] = value; }];
    }, useRef(initial: unknown) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    } },
    "react-native": { Platform: { OS: "web" }, View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView" },
    "@getpaseo/plugin/client/ui": { Icon: "Icon" },
  });
  const { TabStrip } = h.load("client/tabs.tsx");
  const chosen: Id[] = [];
  const scrolledTo: number[] = [];
  const render = () => {
    cursor = 0;
    const outer: Element = TabStrip({ colors: { border: "#333", accent: "#55f", foreground: "#fff", foregroundMuted: "#999", surface0: "#000000", surface2: "#222" },
      tabs: ids.map((id) => ({ id, label: id, icon: "Dot", count: 2 })), selected, onSelect: (id: Id) => chosen.push(id), overflow });
    // A scrolling row is its scroll view plus the edge fades laid over it.
    const [root, before, after]: Array<Element | null> = outer.props.children?.[0]?.type === "ScrollView" ? outer.props.children : [outer, null, null];
    if (root!.props.ref) root!.props.ref.current = { scrollTo: ({ x }: { x: number }) => scrolledTo.push(Math.round(x)) };
    const tabs: Element[] = root!.props.children;
    const tab = (id: Id) => tabs.find((element) => element.props.entry.id === id)!;
    return { root: root!, fades: { before: Boolean(before), after: Boolean(after) }, more: () => after!.props.onPress(), back: () => before!.props.onPress(), tab, layOut: (id: Id) => tab(id).props.onLayout({ nativeEvent: { layout: spans[id] } }) };
  };
  return { render, chosen, scrolledTo };
}

test("on a phone the ticket tabs stay in one row that scrolls sideways", () => {
  const { root, tab } = strip("scroll", "write-up").render();
  assert.equal(root.type, "ScrollView");
  assert.equal(root.props.horizontal, true);
  assert.equal(root.props.contentContainerStyle.flexDirection, "row");
  assert.equal(root.props.contentContainerStyle.flexWrap, undefined, "never wraps onto a second line");
  assert.equal(tab("deliverables").props.entry.icon, null, "no icons, so less of the row is hidden");
});

test("pressing a tab past the edge scrolls it into view", () => {
  const s = strip("scroll", "write-up");
  const view = s.render();
  ids.forEach(view.layOut);
  view.root.props.onLayout({ nativeEvent: { layout: { width: 340 } } });
  assert.deepEqual(s.scrolledTo, [0], "the first tab is already in view");
  view.tab("deliverables").props.onPress();
  assert.deepEqual(s.chosen, ["deliverables"]);
  assert.equal(s.scrolledTo.at(-1), 238, "centered as far as the row goes");
  assert.ok(s.scrolledTo.at(-1)! + 340 >= spans.deliverables.x + spans.deliverables.width, "Deliverables fully visible");
});

test("a tab chosen earlier is scrolled into view when the dialog opens", () => {
  const s = strip("scroll", "deliverables");
  const view = s.render();
  view.root.props.onLayout({ nativeEvent: { layout: { width: 340 } } });
  ids.forEach(view.layOut);
  assert.equal(s.scrolledTo.at(-1), 238);
});

test("the edges fade where tabs are scrolled out of sight", () => {
  const s = strip("scroll", "write-up");
  let view = s.render();
  assert.deepEqual(view.fades, { before: false, after: false }, "nothing measured yet");
  view.root.props.onLayout({ nativeEvent: { layout: { width: 340 } } });
  view.root.props.onContentSizeChange(456, 34);
  view = s.render();
  assert.deepEqual(view.fades, { before: false, after: true }, "Deliverables waits past the right edge");
  view.root.props.onScroll({ nativeEvent: { contentOffset: { x: 116 } } });
  assert.deepEqual(s.render().fades, { before: true, after: false }, "scrolled to the end");
  view.root.props.onScroll({ nativeEvent: { contentOffset: { x: 50 } } });
  view = s.render();
  assert.deepEqual(view.fades, { before: true, after: true });
  view.more();
  assert.equal(s.scrolledTo.at(-1), 116, "the right chevron pages to the end");
  view.back();
  assert.equal(s.scrolledTo.at(-1), 0, "the left chevron pages back to the start");
});

test("on desktop the tabs keep wrapping, dropping their icons first", () => {
  const s = strip("fit", "write-up");
  let view = s.render();
  assert.equal(view.root.type, "View");
  assert.equal(view.root.props.style[0].flexWrap, "wrap");
  assert.equal(view.tab("deliverables").props.entry.icon, "Dot");
  view.root.props.onLayout({ nativeEvent: { layout: { height: 64 } } });
  view = s.render();
  assert.equal(view.tab("deliverables").props.entry.icon, null);
  view.tab("timeline").props.onPress();
  assert.deepEqual(s.scrolledTo, [], "nothing to scroll");
});
