import assert from "node:assert/strict";
import { test } from "node:test";
import { terminalKeys } from "./keys.ts";

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
