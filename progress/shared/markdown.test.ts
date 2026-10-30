import assert from "node:assert/strict";
import test from "node:test";
import { previewText } from "./markdown.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
// The first `count` bytes of `text`, as the server reads them from a longer file.
const head = (text: string, count: number) => bytes(text).subarray(0, count);

test("a cut file ends after its last whole line", () => {
  assert.equal(previewText(head("one\ntwo\nthree", 10), true), "one\ntwo\n");
  assert.equal(previewText(head("one\ntwo\n", 8), true), "one\ntwo\n", "a cut right after a line break keeps that line");
  assert.equal(previewText(head("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |", 34), true), "| a | b |\n|---|---|\n| 1 | 2 |\n", "only whole table rows");
});

test("a cut never ends on half a character", () => {
  for (const character of ["é", "€", "😀"]) {
    const text = `ab\ncd${character}`;
    for (let count = bytes("ab\ncd").length + 1; count < bytes(text).length; count++) {
      assert.equal(previewText(head(text + "\n", count), true), "ab\n", `${character} cut after ${count} bytes`);
    }
  }
  const long = "é".repeat(9000);
  const cut = previewText(head(long, 10_001), true);
  assert.equal(cut, "é".repeat(5000), "no line break near the end: the cut stays where it was, on a whole character");
});

test("a file with no line break in its last 8 KB is cut where the limit falls", () => {
  const text = "first line\n" + "x".repeat(9000);
  assert.equal(previewText(head(text, 9000), true), text.slice(0, 9000));
  const near = "first line\n" + "x".repeat(8000);
  assert.equal(previewText(head(near, 8000), true), "first line\n");
});

test("a file that isn't cut comes back whole, ending as it ends", () => {
  assert.equal(previewText(bytes("one\ntwo"), false), "one\ntwo");
  assert.equal(previewText(bytes(""), false), "");
  assert.equal(previewText(bytes("a�b"), false), "a�b");
});
