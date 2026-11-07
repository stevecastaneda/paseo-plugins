import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));

type Element = { type: unknown; props: Record<string, any> };

const URL_TEXT = "https://example.com/authorize";

// Expands every function component in a tree, leaving host elements and the mocked "Markdown" and "Text" as they are.
function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object") return node;
  const element = node as Element;
  if (typeof element.type === "function") return expand((element.type as (props: unknown) => unknown)(element.props));
  return { ...element, props: { ...element.props, children: expand(element.props?.children) } };
}

function collect(node: unknown, type: string, found: Element[] = []): Element[] {
  if (Array.isArray(node)) node.forEach((child) => collect(child, type, found));
  else if (node && typeof node === "object") {
    const element = node as Element;
    if (element.type === type) found.push(element);
    collect(element.props?.children, type, found);
  }
  return found;
}

function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" ? text((node as Element).props?.children) : "";
}

function AnimatedValue() {}

function renderQuestion(question: Record<string, unknown>, platform = "web") {
  let messages: unknown;
  const h = clientHarness(directory, {
    react: {
      ...React,
      useContext: () => ({ locale: "en", messages }),
      useState: (initial: unknown) => [initial, () => {}],
      useRef: (initial: unknown) => ({ current: initial }),
      useEffect() {},
    },
    "react-native": {
      Platform: { OS: platform },
      View: "View",
      Text: "Text",
      Pressable: "Pressable",
      AccessibilityInfo: { addEventListener: () => ({ remove() {} }), isReduceMotionEnabled: async () => false },
      Easing: { out: (f: unknown) => f, quad: () => 0, cubic: () => 0, bezier: () => () => 0 },
      Animated: { Value: AnimatedValue, timing: () => ({ start() {} }), loop: () => ({ start() {} }), View: "View" },
    },
    "@getpaseo/plugin/client/ui": { Icon: () => null, Markdown: "Markdown", useToast: () => ({}), copyText: async () => {} },
  });
  messages = h.load("client/i18n.ts").messagesFor("en");
  const { QuestionView } = h.load("client/questions.tsx");
  const colors = new Proxy({}, { get: () => "#112233" }); // every theme color, one hex
  return expand(QuestionView({ colors, question, now: Date.parse("2026-11-06T12:00:00Z"), root: "/repo", onCopy() {}, onOpenAttachment() {} }));
}

const question = {
  id: "Q1",
  title: "Sign in",
  question: `Open ${URL_TEXT} to continue`,
  options: [{ letter: "A", label: `Use ${URL_TEXT}/a`, consequence: "Then reload" }],
  recommended: "A",
  state: "waiting",
  background: `Why: sign in at ${URL_TEXT}/background first`,
  files: [],
  askedAt: "2026-11-06T11:00:00Z",
};

test("a question's text and background are drawn with Paseo's Markdown, so a URL in either is a link", () => {
  const tree = renderQuestion(question);
  const drawn = collect(tree, "Markdown").map((element) => text(element));
  assert.ok(drawn.includes(`Open ${URL_TEXT} to continue`), `the question text is not drawn with Markdown: ${JSON.stringify(drawn)}`);
  assert.ok(drawn.includes(`Why: sign in at ${URL_TEXT}/background first`), `the background is not drawn with Markdown: ${JSON.stringify(drawn)}`);
  const plain = collect(tree, "Text")
    .filter((element) => !element.props.selectable)
    .map((element) => text(element));
  assert.ok(!plain.some((value) => value.includes(URL_TEXT + " to continue")), "the question text is also in plain, unselectable Text");
});

test("a question without a background draws no empty Markdown", () => {
  const drawn = collect(renderQuestion({ ...question, background: undefined }), "Markdown").map((element) => text(element));
  assert.deepEqual(drawn, [`Open ${URL_TEXT} to continue`]);
});

test("the text on the question card can be selected: the options' labels and consequences too", () => {
  const texts = collect(renderQuestion(question), "Text");
  for (const wanted of [`Use ${URL_TEXT}/a`, "Then reload"]) {
    const found = texts.find((element) => text(element).includes(wanted));
    assert.ok(found, `no Text carries ${wanted}`);
    assert.equal(found.props.selectable, true, `${wanted} is not selectable`);
  }
});

test("an HTML file on a question links to its full path, so pressing it opens Paseo's preview in a tab on desktop and phones", () => {
  for (const platform of ["web", "ios", "android"]) {
    const tree = renderQuestion({ ...question, files: [{ path: "report/index.html" }, { path: "notes.md" }] }, platform);
    const targets = collect(tree, "Markdown")
      .map((element) => /^\[[^\]]*\]\((\/repo\/[^)]*)\)$/.exec(String(element.props.children))?.[1])
      .filter(Boolean);
    assert.deepEqual(targets, ["/repo/report/index.html"], platform);
  }
});
