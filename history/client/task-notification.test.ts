import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { clientHarness } from "../../test-support/client-harness.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("shows result Markdown immediately, expands details, and copies the result", async () => {
  const copied: string[] = [];
  const h = clientHarness(fileURLToPath(new URL("..", import.meta.url)), {
    "react-native": { Text: "Text", View: "View", Pressable: "Pressable", ScrollView: "ScrollView", Platform: { OS: "web" } },
    "@getpaseo/plugin/client/ui": { Icon: "Icon", Markdown: "Markdown" },
  });
  const Body = h.load("client/task-notification.tsx").TaskNotificationBody;
  const result = "## Findings\n\n**Everything passed.**\n\n<oai-mem-citation>MEMORY.md:3</oai-mem-citation>";
  let renderer;
  await act(async () => { renderer = create(React.createElement(Body, {
    notification: { taskId: "private-task-id", outputFile: "/tmp/private.output", note: "Can resume", status: "completed", summary: 'Agent "Check chart" finished', result, toolUses: 53 },
    colors: {}, copy: (text) => copied.push(text), onError: assert.fail,
  })); });
  const initial = JSON.stringify(renderer.toJSON());
  assert.ok(initial.includes("Check chart"));
  assert.equal(renderer.root.findByType("Markdown").props.children, "## Findings\n\n**Everything passed.**");
  const details = () => renderer.root.findAllByType("Pressable").find((node) => node.props.accessibilityLabel === "Task details");
  assert.ok(!initial.includes("private-task-id"));
  assert.ok(!initial.includes("/tmp/private.output"));
  await act(async () => {
    details().props.onPress();
    renderer.root.findAllByType("Pressable").find((node) => node.props.accessibilityLabel === "Copy task result").props.onPress();
  });
  const expanded = JSON.stringify(renderer.toJSON());
  assert.ok(expanded.includes("private-task-id"));
  assert.ok(expanded.includes("/tmp/private.output"));
  assert.deepEqual(copied, [result]);
  await act(async () => { renderer.unmount(); });
});
