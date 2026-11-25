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

const text = (node: unknown): string =>
  Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text((node as Element).props?.children) : String(node ?? "");

function AnimatedValue() {}

function row(state: string, answer: Record<string, string> = { choice: "B" }) {
  let messages: unknown;
  const requests: Array<[name: string, now: unknown]> = [];
  const h = clientHarness(directory, {
    react: {
      ...React,
      useContext: () => ({ locale: "en", messages }),
      useState: (initial: unknown) => [initial, () => {}],
      useRef: (current: unknown) => ({ current }),
      useEffect() {},
    },
    "react-native": {
      Platform: { OS: "web" },
      View: "View",
      Text: "Text",
      Pressable: "Pressable",
      AccessibilityInfo: { addEventListener: () => ({ remove() {} }), isReduceMotionEnabled: async () => false },
      Easing: { bezier: () => () => 0 },
      Animated: { Value: AnimatedValue, timing: () => ({ start() {} }), View: "View" },
    },
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries() {} }) },
    "@getpaseo/plugin/client": {
      useRpc: (contract: { name: string }) => async (input: { now?: boolean }) => {
        requests.push([contract.name, input.now]);
        return { result: "sent" };
      },
    },
    "@getpaseo/plugin/client/ui": { Icon: () => null, useToast: () => ({ show() {}, error() {} }) },
  });
  messages = h.load("client/i18n.ts").messagesFor("en");
  const { GivenAnswerRow } = h.load("client/given-answer.tsx");
  const tree = all(
    GivenAnswerRow({
      colors: new Proxy({}, { get: () => "#112233" }), // every theme color, one hex
      button: { rest: "", pressed: "" },
      question: { id: "Q2", askedAt: "2026-11-25T12:00:00Z", given: { answer, state } },
      workspaceId: "w",
      root: "/repo",
    }),
  );
  const buttons = tree.filter((element) => element.type === "Pressable");
  return {
    says: text(tree.find((element) => element.type === "Text") ?? ""),
    buttons: buttons.map((element) => element.props.accessibilityLabel),
    press: (label: string) => buttons.find((element) => element.props.accessibilityLabel === label)!.props.onPress(),
    requests,
  };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

test("an answer that waits shows what it is, and can go out now or be discarded", async () => {
  const queued = row("queued");
  assert.equal(queued.says, "Waits for the agent's turn to end: Q2 B");
  assert.deepEqual(queued.buttons, ["Send your answer to Q2 now", "Discard your answer to Q2"]);
  queued.press("Send your answer to Q2 now");
  await settled();
  queued.press("Discard your answer to Q2");
  await settled();
  assert.deepEqual(queued.requests, [
    ["progress.answer.send", true],
    ["progress.answer.cancel", undefined],
  ]);
  const held = row("held");
  assert.equal(held.says, "Not sent yet: Q2 B");
  assert.equal(held.buttons.length, 2);
});

test("a choice that went out shows on its own button only", () => {
  assert.deepEqual([row("sent").says, row("sent").buttons], ["", []]);
});
