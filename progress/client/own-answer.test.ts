import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));

type Element = { type: unknown; props: Record<string, any> };

function all(node: unknown, found: Element[] = []): Element[] {
  if (Array.isArray(node)) node.forEach((child) => all(child, found));
  else if (node && typeof node === "object") {
    const element = node as Element;
    if (typeof element.type === "function") return all((element.type as (props: unknown) => unknown)(element.props), found);
    found.push(element);
    all(element.props?.children, found);
  }
  return found;
}

function AnimatedValue() {}

const question = { id: "Q2", title: "Spacing", options: [], agentId: "a1", askedAt: "2026-11-25T12:00:00Z" };

function field({
  platform = "web",
  agent = { workspaceId: "w" } as { workspaceId: string } | null,
  fails = false,
  result = "sent",
  asked = question as Record<string, unknown>,
} = {}) {
  let messages: unknown;
  let slots: unknown[] = [];
  let cursor = 0;
  const sends: string[] = [];
  const copied: string[] = [];
  const log: string[] = [];
  const requests: Array<{ name: string; input: Record<string, any> }> = [];
  const useRpc = (contract: { name: string }) => async (input: Record<string, any>) => {
    requests.push({ name: contract.name, input });
    if (fails) throw new Error("offline");
    if (contract.name === "progress.answer.send") sends.push("words" in input.answer ? input.answer.words : input.answer.choice);
    return { result };
  };
  // A textarea and the browser's editing command, as far as the field uses them.
  const area = {
    value: "",
    selectionStart: 0,
    selectionEnd: 0,
    setSelectionRange(start: number, end: number) {
      area.selectionStart = start;
      area.selectionEnd = end;
    },
    ownerDocument: {
      execCommand(command: string, _ui: boolean, text = "") {
        log.push(command);
        area.value = area.value.slice(0, area.selectionStart) + text + area.value.slice(area.selectionEnd);
        area.setSelectionRange(area.selectionStart + text.length, area.selectionStart + text.length);
        render().input.onChangeText(area.value);
        return true;
      },
    },
  };
  const h = clientHarness(directory, {
    react: {
      ...React,
      useContext: () => ({ locale: "en", messages }),
      useRef: (current: unknown) => ({ current }),
      useEffect() {},
      useState(initial: unknown) {
        const slot = cursor++;
        if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
        return [slots[slot], (value: unknown) => (slots[slot] = value)];
      },
    },
    "react-native": {
      Platform: { OS: platform },
      View: "View",
      Text: "Text",
      Pressable: "Pressable",
      AccessibilityInfo: { addEventListener: () => ({ remove() {} }), isReduceMotionEnabled: async () => false },
      Easing: { bezier: () => () => 0 },
      Animated: { Value: AnimatedValue, timing: () => ({ start() {} }), View: "View" },
    },
    "@getpaseo/plugin/client": {
      useRpc,
      useAgent: (_id: string, select: (snapshot: unknown) => unknown) => (agent ? select(agent) : null),
    },
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries() {} }) },
    "@getpaseo/plugin/client/ui": { TextInput: "TextInput", Icon: () => null, useToast: () => ({ show() {}, error() {} }) },
  });
  messages = h.load("client/i18n.ts").messagesFor("en");
  const { OwnAnswer } = h.load("client/own-answer.tsx");
  let closed = 0;
  function render() {
    cursor = 0;
    const tree = all(
      OwnAnswer({
        colors: new Proxy({}, { get: () => "#112233" }), // every theme color, one hex
        button: { rest: "", pressed: "" },
        question: asked,
        workspaceId: "w",
        root: "/repo",
        onCopy: (answer: string) => copied.push(answer),
        onSent: () => closed++,
      }),
    );
    const buttons = tree.flatMap((element) => (element.props.accessibilityLabel && element.type === "Pressable" ? [element.props.accessibilityLabel] : []));
    const press = (label: string) => tree.find((element) => element.props.accessibilityLabel === label)?.props.onPress;
    return {
      input: tree.find((element) => element.type === "TextInput")!.props,
      buttons: [...new Set(buttons)],
      press,
      send: press("Send your own answer to Q2 to your agent"),
      copy: press("Copy your own answer to Q2 for your agent"),
      texts: tree.filter((element) => element.type === "Text").map((element) => [element.props.children].flat().join("")),
    };
  }
  return {
    render,
    sends,
    requests,
    copied,
    log,
    area,
    closed: () => closed,
    type(text: string) {
      area.value = text;
      area.setSelectionRange(text.length, text.length);
      render().input.onChangeText(text);
    },
    key(nativeEvent: Record<string, unknown>) {
      let prevented = false;
      render().input.onKeyPress({ nativeEvent, target: area, preventDefault: () => (prevented = true) });
      return prevented;
    },
    reopen() {
      slots = [];
      return render();
    },
  };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

test("the user's own answer goes to the server for the question it's about", async () => {
  const f = field();
  assert.equal(f.render().send, undefined, "nothing written, nothing to send");
  f.type("Bigger, please");
  f.render().send();
  await settled();
  assert.deepEqual(JSON.parse(JSON.stringify(f.requests)), [
    {
      name: "progress.answer.send",
      input: { workspaceId: "w", workspaceDirectory: "/repo", questionId: "Q2", askedAt: question.askedAt, answer: { words: "Bigger, please" }, now: false },
    },
  ]);
  assert.equal(f.closed(), 1);
  assert.equal(f.reopen().input.value, "");
});

test("a draft is kept until the server has the answer", async () => {
  for (const [result, kept] of [
    ["sent", ""],
    ["queued", ""],
    ["held", ""],
    ["gone", "Words"],
    ["closed", "Words"],
  ]) {
    const f = field({ result });
    f.type("Words");
    f.render().send();
    await settled();
    assert.equal(f.reopen().input.value, kept, result);
  }
});

test("a draft survives closing the dialog, and a send that failed", async () => {
  const f = field({ fails: true });
  f.type("Half a thought");
  assert.equal(f.reopen().input.value, "Half a thought");
  f.render().send();
  await settled();
  assert.equal(f.reopen().input.value, "Half a thought");
});

test("without an agent here, the answer can only be copied", () => {
  for (const f of [field({ agent: null }), field({ agent: { workspaceId: "elsewhere" } }), field({ asked: { ...question, agentId: undefined } })]) {
    f.type(" Bigger ");
    const view = f.render();
    assert.equal(view.send, undefined);
    view.copy();
    f.key({ key: "Enter", metaKey: true });
    assert.deepEqual(f.copied, ["Bigger", "Bigger"]);
  }
});

test("on desktop, Enter continues a list as a typed edit, so undo works", () => {
  const f = field();
  f.type("- one");
  assert.equal(f.key({ key: "Enter" }), true);
  assert.equal(f.render().input.value, "- one\n- ");
  assert.equal(f.key({ key: "Enter" }), true);
  assert.equal(f.render().input.value, "- one\n");
  assert.deepEqual(f.log, ["insertText", "delete"]);
});

test("on desktop, other keys are left to the browser", () => {
  const f = field();
  f.type("- one");
  assert.equal(f.key({ key: "Enter", shiftKey: true }), false);
  assert.equal(f.key({ key: "Enter", isComposing: true }), false);
  assert.equal(f.key({ key: "a" }), false);
  f.type("text");
  assert.equal(f.key({ key: "Enter" }), false);
  assert.equal(f.key({ key: "Tab" }), false, "Tab leaves the field outside a list");
  assert.deepEqual(f.sends, []);
});

test("Tab moves a list item in, and Cmd or Ctrl+Enter sends", async () => {
  const f = field();
  f.type("- one");
  assert.equal(f.key({ key: "Tab" }), true);
  assert.equal(f.render().input.value, "  - one");
  assert.equal(f.key({ key: "Enter", ctrlKey: true }), true);
  await settled();
  assert.deepEqual(f.sends, ["  - one"]);
});

test("on a phone, a typed line break continues the list and moves the cursor", () => {
  const f = field({ platform: "ios" });
  f.type("1. one\n2. two");
  f.type("1. one\n\n2. two");
  const { input } = f.render();
  assert.equal(input.value, "1. one\n2. \n3. two");
  assert.deepEqual({ ...input.selection }, { start: 10, end: 10 });
  input.onSelectionChange();
  assert.equal(f.render().input.selection, undefined, "the keyboard owns the cursor again");
});
