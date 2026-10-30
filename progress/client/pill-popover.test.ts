import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));

type Element = { type: unknown; props: Record<string, any> };

function find(node: unknown, matches: (props: Record<string, any>) => boolean): Element | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) return node.map((child) => find(child, matches)).find(Boolean);
  const element = node as Element;
  return matches(element.props ?? {}) ? element : find(element.props?.children, matches);
}

function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" ? text((node as Element).props?.children) : "";
}

function popover(questions: string[]) {
  let messages: unknown;
  let slots: unknown[] = [];
  let cursor = 0;
  const h = clientHarness(directory, {
    react: { ...React, useContext: () => ({ locale: "en", messages }), useState(initial: unknown) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
      return [slots[slot], (value: unknown) => { slots[slot] = value; }];
    }, useRef(initial: unknown) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    } },
    "react-native": { Platform: { OS: "web" }, View: "View", Text: "Text" },
    "@getpaseo/plugin/client/ui": { Icon: () => null, ScrollView: "ScrollView", useToast: () => ({}), copyText: async () => {} },
  });
  messages = h.load("client/i18n.ts").messagesFor("en");
  const { AttentionList } = h.load("client/pill-popover.tsx");
  const copied: string[] = [];
  const dashboard = { questions: { open: questions.map((id) => ({ id, question: `Question ${id}`, options: [] })) }, stuck: [] };
  const render = () => {
    cursor = 0;
    const tree = AttentionList({ colors: { surface0: "#ffffff", surface1: "#f4f4f5" }, dashboard, workspaceId: "w", compact: false, touch: false, onSurface1: true,
      onCopy: (question: { id: string }, letter: string) => copied.push(`${question.id} ${letter}`), onOpenAttachment() {} });
    const shown = find(tree, (props) => "question" in props && "onCopy" in props);
    const button = (label: string): Record<string, any> => {
      const step = find(tree, (props) => props.label === label);
      return step ? (step.type as (props: unknown) => Element)(step.props).props : {};
    };
    const listHookCursor = cursor;
    const drawList = () => {
      cursor = listHookCursor;
      const element = find(tree, (props) => "maxHeight" in props)!;
      const drawn = (element.type as (props: unknown) => Element)(element.props);
      const scroll = find(drawn, (props) => "onScroll" in props)!.props;
      const fade = drawn.props.children[1] as Element | null;
      return { scroll, fade: fade && (fade.type as (props: unknown) => Element)(fade.props) };
    };
    return { drawList, shown: shown?.props.question.id, header: text(find(tree, (props) => typeof props.children?.[0] === "string" && props.children[0].startsWith("Question "))),
      back: button("Previous question"), next: button("Next question"), copy: (letter: string) => shown!.props.onCopy(letter) };
  };
  return { render, copied, open() { slots = []; return render(); } };
}

test("the pill popover shows one question at a time and steps with back and next", () => {
  const p = popover(["Q1", "Q2", "Q3"]);
  let view = p.open();
  assert.equal(view.shown, "Q1");
  assert.equal(view.header, "Question 1 of 3");
  assert.equal(view.back.accessibilityLabel, "Previous question");
  assert.equal(view.back.disabled, true);
  assert.equal(view.back.onPress, undefined);
  view.next.onPress();
  view = p.render();
  assert.equal(view.shown, "Q2");
  assert.equal(view.header, "Question 2 of 3");
  assert.equal(view.back.disabled, false);
  view.next.onPress();
  view = p.render();
  assert.equal(view.shown, "Q3");
  assert.equal(view.next.disabled, true, "no wrap past the last question");
  view.back.onPress();
  assert.equal(p.render().shown, "Q2");
});

test("reopening the popover returns to the shown question, and after a copy to the one after it", () => {
  const p = popover(["Q1", "Q2", "Q3"]);
  p.open().next.onPress();
  assert.equal(p.open().shown, "Q2", "reopened where the user left off");
  p.render().copy("A");
  assert.deepEqual(p.copied, ["Q2 A"]);
  assert.equal(p.open().shown, "Q3", "the copy closed the popover; the next open lands on the next question");
});

test("a single question has no stepping header", () => {
  const view = popover(["Q1"]).open();
  assert.equal(view.shown, "Q1");
  assert.equal(view.header, "");
});

test("a question taller than the list fades at the bottom until scrolled to the end", () => {
  const view = popover(["Q1"]).open();
  const report = (event: string, ...args: unknown[]) => { view.drawList().scroll[event](...args); return Boolean(view.drawList().fade); };
  assert.equal(Boolean(view.drawList().fade), false, "nothing measured yet");
  report("onLayout", { nativeEvent: { layout: { height: 300 } } });
  assert.equal(report("onContentSizeChange", 360, 500), true, "content continues below the viewport");
  assert.equal(view.drawList().fade!.props.pointerEvents, "none", "presses reach the Copy buttons under the fade");
  assert.equal(report("onScroll", { nativeEvent: { contentOffset: { y: 100 } } }), true, "still 100px left");
  assert.equal(report("onScroll", { nativeEvent: { contentOffset: { y: 200 } } }), false, "scrolled to the end");
  assert.equal(report("onScroll", { nativeEvent: { contentOffset: { y: 150 } } }), true, "scrolled back up");
});

test("a question that fits the list shows no fade", () => {
  const view = popover(["Q1"]).open();
  view.drawList().scroll.onLayout({ nativeEvent: { layout: { height: 200 } } });
  view.drawList().scroll.onContentSizeChange(360, 200);
  assert.equal(view.drawList().fade, null);
});

function arrowSize(layout: { compact: boolean; platform: "ios" | "android" | "web" }): number {
  let messages: unknown;
  const dashboard = { questions: { open: ["Q1", "Q2"].map((id) => ({ id, question: `Question ${id}`, options: [] })) }, stuck: [] };
  const h = clientHarness(directory, {
    react: { ...React, useContext: () => ({ locale: "en", messages }), useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, () => {}], useRef: (current: unknown) => ({ current }) },
    "react-native": { Platform: { OS: "web" }, View: "View", Text: "Text" },
    "@getpaseo/plugin/client": { useWorkspace: () => "/work", useRpc: () => async () => ({}), useAgent: () => null },
    "@tanstack/react-query": { useQuery: () => ({ data: { configured: true, root: "/work", dashboard } }), useQueryClient: () => ({ getQueryData: () => undefined }) },
    "@getpaseo/plugin/client/ui": { Icon: () => null, ScrollView: "ScrollView", Modal: "Modal", Markdown: "Markdown", useToast: () => ({}), copyText: async () => {} },
  });
  messages = h.load("client/i18n.ts").messagesFor("en");
  const { AttentionPopover } = h.load("client/pill-popover.tsx");
  const tree = AttentionPopover({ theme: { colors: { surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#000" } }, host: { id: "h" }, layout,
    workspaceId: "w", close() {}, openPanel() {} });
  const list = find(tree, (props) => "dashboard" in props && "touch" in props)!;
  const drawn = (list.type as (props: unknown) => Element)(list.props);
  const next = find(drawn, (props) => props.label === "Next question")!;
  const button = (next.type as (props: unknown) => Element)(next.props);
  return button.props.style({ pressed: false }).width;
}

test("the question arrows are finger-sized on any phone-sized screen, phone browsers included", () => {
  assert.equal(arrowSize({ compact: true, platform: "ios" }), 36);
  assert.equal(arrowSize({ compact: true, platform: "web" }), 36);
  assert.equal(arrowSize({ compact: false, platform: "web" }), 24, "desktop keeps the small arrows");
});
