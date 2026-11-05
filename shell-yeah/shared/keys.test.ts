import assert from "node:assert/strict";
import { test } from "node:test";
import { pastedKeys, terminalKeys } from "./keys.ts";

test("keys a text box can't type become what a terminal sends", () => {
  assert.equal(terminalKeys({ key: "Enter" }), "\r");
  assert.equal(terminalKeys({ key: "Backspace" }), "\x7f");
  assert.equal(terminalKeys({ key: "ArrowUp" }), "\x1b[A");
  assert.equal(terminalKeys({ key: "ArrowLeft" }), "\x1b[D");
  assert.equal(terminalKeys({ key: "Delete" }), "\x1b[3~");
});

test("Ctrl+letter is a control key, but Ctrl+V still pastes and Cmd stays with the app", () => {
  assert.equal(terminalKeys({ key: "c", ctrlKey: true }), "\x03");
  assert.equal(terminalKeys({ key: "D", ctrlKey: true }), "\x04");
  assert.equal(terminalKeys({ key: "v", ctrlKey: true }), null);
  assert.equal(terminalKeys({ key: "v", metaKey: true }), null);
  assert.equal(terminalKeys({ key: "Enter", metaKey: true }), null);
});

test("letters, Tab and Escape are left to the box", () => {
  assert.equal(terminalKeys({ key: "y" }), null);
  assert.equal(terminalKeys({ key: "Tab" }), null);
  assert.equal(terminalKeys({ key: "Escape" }), null);
});

test("a paste can't press keys: line breaks and control characters go, tabs and text stay", () => {
  assert.equal(pastedKeys("tok_live_9f3a\n"), "tok_live_9f3a", "a trailing line break doesn't press Return");
  assert.equal(pastedKeys("y\r\nrm -rf ~\r\n"), "yrm -rf ~", "a hidden second line doesn't run");
  assert.equal(pastedKeys("a\x03b\x1b[2~c\x9bd\x7f"), "ab[2~cd", "Ctrl+C, ESC, CSI and DEL go");
  assert.equal(pastedKeys("name\tvalue é 🔑"), "name\tvalue é 🔑");
  assert.equal(pastedKeys("\n\x1b"), null);
});
