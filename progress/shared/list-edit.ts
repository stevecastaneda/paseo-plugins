// What Enter and Tab do inside a list while the user types an answer. Plain
// text in, one replacement out, so the desktop app and the phone apps share it.

export interface Edit {
  // Replaces text[from, to) with `insert`, then puts the cursor at `cursor`.
  from: number;
  to: number;
  insert: string;
  cursor: number;
  // The other end of the selection, when the edit keeps one.
  cursorEnd?: number;
}

interface Item {
  indent: string;
  // "-", "*", "+" or "•"; or a number and its "." or ")".
  bullet?: string;
  number?: number;
  close?: string;
  gap: string;
  task: boolean;
  // Everything before the item's own text.
  length: number;
}

const ITEM = /^([ \t]*)(?:([-*+•])|(\d{1,6})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;

function itemOf(line: string): Item | null {
  const match = ITEM.exec(line);
  if (!match) return null;
  const [all, indent, bullet, number, close, gap, task] = match;
  return { indent, bullet, number: number === undefined ? undefined : Number(number), close, gap, task: task !== undefined, length: all.length };
}

function marker({ indent, bullet, number, close, gap, task }: Omit<Item, "length">, nth = number): string {
  return `${indent}${bullet ?? `${nth}${close}`}${gap}${task ? "[ ] " : ""}`;
}

// Where the line holding `at` starts. lastIndexOf reads a negative start as 0.
function lineStart(text: string, at: number): number {
  return at === 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1;
}

function lineEnd(text: string, at: number): number {
  const end = text.indexOf("\n", at);
  return end === -1 ? text.length : end;
}

export function applyEdit(text: string, edit: Edit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

// The numbers after a new item each go up by one. Deeper lines belong to the
// items above them; anything else ends the list.
function renumbered(text: string, from: number, item: Item): { to: number; insert: string } {
  let to = from;
  let insert = "";
  let pending = "";
  let next = item.number! + 2;
  for (let at = from; at < text.length;) {
    const end = lineEnd(text, at + 1);
    const line = text.slice(at + 1, end);
    const found = itemOf(line);
    if (found && found.indent === item.indent && found.number === next - 1 && found.close === item.close) {
      insert += `${pending}\n${found.indent}${next}${line.slice(found.indent.length + String(found.number).length)}`;
      pending = "";
      to = end;
      next++;
    } else if (line.startsWith(`${item.indent} `) || line.startsWith(`${item.indent}\t`)) {
      pending += `\n${line}`;
    } else break;
    at = end;
  }
  return { to, insert };
}

// Enter: the next item, or out of the list from an item left empty. Null for
// a plain line break.
export function enterEdit(text: string, start: number, end: number): Edit | null {
  const from = lineStart(text, start);
  const item = itemOf(text.slice(from, start));
  if (!item) return null;
  const until = lineEnd(text, end);
  if (start === end && !text.slice(from + item.length, until).trim()) {
    const insert = outdented(text, from, item);
    return { from, to: until, insert, cursor: from + insert.length };
  }
  const insert = `\n${marker(item, item.number === undefined ? undefined : item.number + 1)}`;
  const cursor = start + insert.length;
  if (item.number === undefined) return { from: start, to: end, insert, cursor };
  const rest = renumbered(text, until, item);
  // Only as far as the last number that changes.
  return rest.to === until
    ? { from: start, to: end, insert, cursor }
    : { from: start, to: rest.to, insert: insert + text.slice(end, until) + rest.insert, cursor };
}

// An empty item one level up, as the next item of the list it lands in; at the
// top level, no item at all.
function outdented(text: string, from: number, item: Item): string {
  if (!item.indent) return "";
  for (let at = from; at > 0;) {
    const previous = lineStart(text, at - 1);
    const parent = itemOf(text.slice(previous, at - 1));
    if (parent && parent.indent.length < item.indent.length) return marker(parent, parent.number === undefined ? undefined : parent.number + 1);
    at = previous;
  }
  return marker({ ...item, indent: "" });
}

// Tab and Shift+Tab: the selected list items one level deeper or back. Null
// outside a list, where Tab moves on to the next control as usual.
export function indentEdit(text: string, start: number, end: number, back: boolean): Edit | null {
  const from = lineStart(text, start);
  const to = lineEnd(text, end);
  const lines = text.slice(from, to).split("\n");
  if (!lines.some((line) => itemOf(line))) return null;
  const moved = lines.map((line) => (!line.trim() ? line : back ? line.replace(/^(?:\t| {1,2})/, "") : `  ${line}`));
  const insert = moved.join("\n");
  const first = moved[0].length - lines[0].length;
  const cursor = Math.max(from, start + first);
  return { from, to, insert, cursor, cursorEnd: Math.max(cursor, end + insert.length - (to - from)) };
}

// Where the phone keyboard put a line break, or null when anything else changed.
// Beside other line breaks every spot reads the same; the first one is the end
// of the line above, where people press Enter.
export function typedBreak(before: string, after: string): number | null {
  if (after.length !== before.length + 1) return null;
  let at = 0;
  while (at < before.length && before[at] === after[at]) at++;
  if (after[at] !== "\n" || before.slice(at) !== after.slice(at + 1)) return null;
  while (at > 0 && after[at - 1] === "\n") at--;
  return at;
}
