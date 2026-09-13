import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { clientHarness } from "../../test-support/client-harness.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("renders messages and safe HTML, copies code, and keeps metadata out of the view", async () => {
  const copied: string[] = [];
  const opened: string[] = [];
  const h = clientHarness(fileURLToPath(new URL("..", import.meta.url)), {
    "react-native": { Text: "Text", View: "View", Pressable: "Pressable", ScrollView: "ScrollView",
      Platform: { OS: "web" }, Linking: { openURL: async (href) => { opened.push(href); } } },
    "@getpaseo/plugin/client/react-native": { Icon: "Icon" },
  });
  const Markdown = h.load("client/markdown.tsx").MarkdownMessage;
  const code = 'const text = "<script>literal</script>";';
  const source = '# Result\n\n**Bold** and [docs](https://paseo.sh) with [file](/tmp/report.md).\n\n```js\n' + code
    + '\n```\n\n<script>alert(1)</script>\n\n<oai-mem-citation>PRIVATE_METADATA</oai-mem-citation>';
  let renderer;
  await act(async () => { renderer = create(React.createElement(Markdown, {
    text: source, colors: {}, copy: (text) => copied.push(text), onError: assert.fail,
  })); });
  const json = JSON.stringify(renderer.toJSON());
  assert.ok(json.includes("Result"));
  assert.ok(json.includes('"fontWeight":"700"'));
  assert.ok(json.includes("<script>alert(1)</script>"));
  assert.ok(!json.includes("PRIVATE_METADATA"));
  assert.equal(renderer.root.findAllByType("ScrollView")[0].props.horizontal, true);
  await act(async () => {
    renderer.root.findAllByType("Pressable").find((node) => node.props.accessibilityLabel === "Copy code").props.onPress();
    renderer.root.findAllByType("Text").find((node) => node.props.accessibilityLabel === "Open docs").props.onPress();
    renderer.root.findAllByType("Text").find((node) => node.props.accessibilityLabel === "Copy destination: file").props.onPress();
  });
  assert.deepEqual(copied, [code, "/tmp/report.md"]);
  assert.deepEqual(opened, ["https://paseo.sh"]);
  await act(async () => { renderer.unmount(); });
});
