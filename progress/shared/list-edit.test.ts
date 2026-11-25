import assert from "node:assert/strict";
import test from "node:test";
import { applyEdit, enterEdit, indentEdit, typedBreak } from "./list-edit.ts";

// "|" is the cursor; two of them are a selection.
function at(marked: string) {
  const start = marked.indexOf("|");
  const second = marked.indexOf("|", start + 1);
  const text = marked.replaceAll("|", "");
  return { text, start, end: second === -1 ? start : second - 1 };
}

function enter(marked: string): string | null {
  const { text, start, end } = at(marked);
  const edit = enterEdit(text, start, end);
  if (!edit) return null;
  const next = applyEdit(text, edit);
  return `${next.slice(0, edit.cursor)}|${next.slice(edit.cursor)}`;
}

function tab(marked: string, back = false): string | null {
  const { text, start, end } = at(marked);
  const edit = indentEdit(text, start, end, back);
  if (!edit) return null;
  const next = applyEdit(text, edit);
  return edit.cursorEnd === edit.cursor
    ? `${next.slice(0, edit.cursor)}|${next.slice(edit.cursor)}`
    : `${next.slice(0, edit.cursor)}|${next.slice(edit.cursor, edit.cursorEnd)}|${next.slice(edit.cursorEnd)}`;
}

test("Enter continues a list", () => {
  assert.equal(enter("- one|"), "- one\n- |");
  assert.equal(enter("* one|"), "* one\n* |");
  assert.equal(enter("1. one|"), "1. one\n2. |");
  assert.equal(enter("9) one|"), "9) one\n10) |");
  assert.equal(enter("- [x] one|"), "- [x] one\n- [ ] |");
  assert.equal(enter("intro\n  - one|"), "intro\n  - one\n  - |");
  assert.equal(enter("- one|\n- two"), "- one\n- |\n- two");
  assert.equal(enter("- one |two"), "- one \n- |two");
  assert.equal(enter("- one |two| three"), "- one \n- | three");
});

test("Enter outside a list is a plain line break", () => {
  for (const marked of ["|", "text|", "-|", "-no space|", "1.5 hours|", "|- one", "\n|", "|\n- one", "2026. |".replace("2026. ", "20261234. ")]) {
    assert.equal(enter(marked), null, JSON.stringify(marked));
  }
});

test("Enter on an empty item leaves the list, one level at a time", () => {
  assert.equal(enter("- one\n- |"), "- one\n|");
  assert.equal(enter("1. one\n2. |\nafter"), "1. one\n|\nafter");
  assert.equal(enter("- [ ] |"), "|");
  assert.equal(enter("1. one\n  - sub\n  - |"), "1. one\n  - sub\n2. |");
  assert.equal(enter("- one\n    - |"), "- one\n- |");
});

test("a new item in a numbered list renumbers the ones after it", () => {
  assert.equal(enter("1. a|\n2. b\n3. c"), "1. a\n2. |\n3. b\n4. c");
  assert.equal(enter("1. a|\n  - x\n2. b\n\n3. c"), "1. a\n2. |\n  - x\n3. b\n\n3. c");
  assert.equal(enter("1. a|\n7. b"), "1. a\n2. |\n7. b", "a list that isn't counted stays as written");
  assert.equal(enter("1. a|b\n2. c\ntext"), "1. a\n2. |b\n3. c\ntext");
});

test("Tab moves list items in and out, and is left alone elsewhere", () => {
  assert.equal(tab("- one|"), "  - one|");
  assert.equal(tab("  - one|", true), "- one|");
  assert.equal(tab("- |one", true), "- |one");
  assert.equal(tab("- o|ne\n- tw|o"), "  - o|ne\n  - tw|o");
  assert.equal(tab("text|"), null);
  assert.equal(tab("text|", true), null);
});

test("a line break typed on a phone is found, and nothing else is taken for one", () => {
  assert.equal(typedBreak("- a", "- a\n"), 3);
  assert.equal(typedBreak("- a\n- b", "- a\n\n- b"), 3, "the end of the line above");
  assert.equal(typedBreak("ab", "a\nb"), 1);
  assert.equal(typedBreak("", "\n"), 0);
  assert.equal(typedBreak("a", "ab"), null);
  assert.equal(typedBreak("a\n", "a"), null);
  assert.equal(typedBreak("a", "a\n\n"), null);
  assert.equal(typedBreak("teh", "the\n"), null, "autocorrect changed more than the break");
});
