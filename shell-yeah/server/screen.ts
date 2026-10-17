import { LIMITS } from "../shared/limits.ts";
import type { Line, Segment } from "../shared/row.ts";

export interface ScreenLimits {
  maxLines: number;
  maxLineChars: number;
}

export const DEFAULT_SCREEN_LIMITS: ScreenLimits = { maxLines: LIMITS.linesKept, maxLineChars: LIMITS.lineChars };

// A tiny terminal: decoded text in, styled lines out. Owns the whole answer to
// "what is on screen": \r overwrites, \b, tabs, cursor moves, erase, clear, SGR.
// Nothing else in the plugin looks at escape codes.
export interface Screen {
  write(text: string): void;
  // The last `count` lines, the cursor's empty trailing line excluded.
  tail(count: number): { lines: Line[]; total: number };
  // Plain text of every retained line.
  text(): string;
  // Lines dropped from the front because of maxLines.
  readonly dropped: number;
  // Push one dimmed line of our own ("[binary output hidden]") after the current line.
  note(text: string): void;
}

interface Seg {
  text: string;
  len: number;
  sgr: string;
}

interface Row {
  segs: Seg[];
  len: number;
  clamped: boolean;
}

interface Pen {
  attrs: Set<number>;
  fg: string | null;
  bg: string | null;
}

const ATTRS = [1, 2, 3, 4, 7, 8, 9];
const ATTR_OFF: Record<number, number[]> = { 22: [1, 2], 23: [3], 24: [4], 27: [7], 28: [8], 29: [9] };
const CONTROL = /[\x00-\x1f\x7f]/;
const MAX_PENDING = 4096;
const CLAMP_MARK = "…";

export function createScreen(limits: ScreenLimits = DEFAULT_SCREEN_LIMITS): Screen {
  const rows: Row[] = [emptyRow()];
  let row = 0;
  let col = 0;
  let dropped = 0;
  let pending = "";
  const pen: Pen = { attrs: new Set(), fg: null, bg: null };
  let penKey = "";
  const interned = new Map<string, string>();

  function emptyRow(): Row {
    return { segs: [], len: 0, clamped: false };
  }

  function trimRows() {
    // The empty row the cursor sits on after a newline is not a line yet.
    const slack = row === rows.length - 1 && rows[rows.length - 1].len === 0 ? 1 : 0;
    while (rows.length > limits.maxLines + slack) {
      rows.shift();
      dropped++;
      row = Math.max(0, row - 1);
    }
  }

  function moveDown(n: number) {
    row += n;
    while (row >= rows.length) rows.push(emptyRow());
    trimRows();
  }

  function newline() {
    moveDown(1);
    col = 0;
  }

  function cells(r: Row): Segment[] {
    const out: Segment[] = [];
    for (const seg of r.segs) for (const ch of seg.text) out.push([ch, seg.sgr]);
    return out;
  }

  function fromCells(list: Segment[]): Row {
    const r = emptyRow();
    for (const [ch, sgr] of list) appendSeg(r, ch, 1, sgr);
    return r;
  }

  function appendSeg(r: Row, text: string, len: number, sgr: string) {
    const last = r.segs[r.segs.length - 1];
    if (last && last.sgr === sgr) {
      last.text += text;
      last.len += len;
    } else {
      r.segs.push({ text, len, sgr });
    }
    r.len += len;
  }

  function clamp(r: Row) {
    if (r.clamped || r.len <= limits.maxLineChars) return;
    const kept = cells(r).slice(0, limits.maxLineChars);
    const cut = fromCells(kept);
    appendSeg(cut, CLAMP_MARK, 1, "");
    cut.clamped = true;
    rows[row] = cut;
    col = Math.min(col, cut.len);
  }

  function put(text: string) {
    const r = rows[row];
    if (r.clamped) return;
    const len = codePoints(text);
    if (col === r.len) {
      appendSeg(r, text, len, penKey);
    } else if (col > r.len) {
      appendSeg(r, " ".repeat(col - r.len), col - r.len, "");
      appendSeg(r, text, len, penKey);
    } else {
      const list = cells(r);
      const incoming: Segment[] = [...text].map((ch) => [ch, penKey]);
      list.splice(col, incoming.length, ...incoming);
      rows[row] = fromCells(list);
    }
    col += len;
    clamp(rows[row]);
  }

  function eraseLine(mode: number) {
    const r = rows[row];
    if (mode === 2) {
      rows[row] = emptyRow();
    } else if (mode === 1) {
      const list = cells(r);
      for (let i = 0; i <= col && i < list.length; i++) list[i] = [" ", ""];
      rows[row] = fromCells(list);
    } else {
      rows[row] = fromCells(cells(r).slice(0, col));
    }
  }

  function clearAll() {
    rows.length = 0;
    rows.push(emptyRow());
    row = 0;
    col = 0;
  }

  function csi(params: string, final: string) {
    const nums = params.split(";").map((p) => (p === "" ? 0 : Number.parseInt(p, 10)));
    const n = Math.max(1, nums[0] || 0);
    switch (final) {
      case "A": row = Math.max(0, row - n); break;
      case "B": moveDown(n); break;
      case "C": col += n; break;
      case "D": col = Math.max(0, col - n); break;
      case "E": moveDown(n); col = 0; break;
      case "F": row = Math.max(0, row - n); col = 0; break;
      case "G": col = n - 1; break;
      case "H":
      case "f": {
        row = Math.max(0, (nums[0] || 1) - 1);
        while (row >= rows.length) rows.push(emptyRow());
        col = Math.max(0, (nums[1] || 1) - 1);
        break;
      }
      case "K": eraseLine(nums[0] || 0); break;
      case "J": {
        const mode = nums[0] || 0;
        if (mode === 0) {
          eraseLine(0);
          rows.length = row + 1;
        } else if (mode >= 2) clearAll();
        break;
      }
      case "m": if (!params.startsWith("?")) applySgr(nums); break;
      default: break;
    }
  }

  function applySgr(nums: number[]) {
    if (nums.length === 0) nums = [0];
    for (let i = 0; i < nums.length; i++) {
      const p = nums[i];
      if (Number.isNaN(p)) continue;
      if (p === 0) {
        pen.attrs.clear();
        pen.fg = null;
        pen.bg = null;
      } else if (ATTRS.includes(p)) pen.attrs.add(p);
      else if (ATTR_OFF[p]) for (const a of ATTR_OFF[p]) pen.attrs.delete(a);
      else if ((p >= 30 && p <= 37) || (p >= 90 && p <= 97)) pen.fg = String(p);
      else if ((p >= 40 && p <= 47) || (p >= 100 && p <= 107)) pen.bg = String(p);
      else if (p === 39) pen.fg = null;
      else if (p === 49) pen.bg = null;
      else if (p === 38 || p === 48) {
        const mode = nums[i + 1];
        let value: string | null = null;
        if (mode === 5 && nums.length > i + 2) {
          value = `${p};5;${clampByte(nums[i + 2])}`;
          i += 2;
        } else if (mode === 2 && nums.length > i + 4) {
          value = `${p};2;${clampByte(nums[i + 2])};${clampByte(nums[i + 3])};${clampByte(nums[i + 4])}`;
          i += 4;
        } else break;
        if (p === 38) pen.fg = value;
        else pen.bg = value;
      }
    }
    const key = [...[...pen.attrs].sort((a, b) => a - b).map(String), ...(pen.fg ? [pen.fg] : []), ...(pen.bg ? [pen.bg] : [])].join(";");
    penKey = interned.get(key) ?? (interned.set(key, key), key);
  }

  // Returns the index just past the escape sequence starting at `i`, or -1 if it is incomplete.
  function escape(text: string, i: number): number {
    const next = text[i + 1];
    if (next === undefined) return -1;
    if (next === "[") {
      let j = i + 2;
      while (j < text.length && text.charCodeAt(j) >= 0x30 && text.charCodeAt(j) <= 0x3f) j++;
      while (j < text.length && text.charCodeAt(j) >= 0x20 && text.charCodeAt(j) <= 0x2f) j++;
      if (j >= text.length) return -1;
      const finalCode = text.charCodeAt(j);
      if (finalCode >= 0x40 && finalCode <= 0x7e) csi(text.slice(i + 2, j).replace(/[\x20-\x2f]/g, ""), text[j]);
      return j + 1;
    }
    if (next === "]") {
      const bel = text.indexOf("\x07", i + 2);
      const st = text.indexOf("\x1b\\", i + 2);
      if (bel === -1 && st === -1) return -1;
      if (bel !== -1 && (st === -1 || bel < st)) return bel + 1;
      return st + 2;
    }
    if (next === "(" || next === ")" || next === "*" || next === "+" || next === "#") {
      return text[i + 2] === undefined ? -1 : i + 3;
    }
    return i + 2;
  }

  function write(input: string) {
    let text = pending + input;
    pending = "";
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      const code = text.charCodeAt(i);
      if (code >= 0x20 && code !== 0x7f) {
        const match = CONTROL.exec(text.slice(i));
        const end = match ? i + match.index : text.length;
        put(text.slice(i, end));
        i = end;
        continue;
      }
      if (ch === "\x1b") {
        const end = escape(text, i);
        if (end === -1) {
          const rest = text.slice(i);
          if (rest.length < MAX_PENDING) pending = rest;
          return;
        }
        i = end;
        continue;
      }
      if (ch === "\n") newline();
      else if (ch === "\r") col = 0;
      else if (ch === "\b") col = Math.max(0, col - 1);
      else if (ch === "\t") {
        const target = (Math.floor(col / 8) + 1) * 8;
        const saved = penKey;
        penKey = "";
        put(" ".repeat(target - col));
        penKey = saved;
      }
      i++;
    }
  }

  function visibleRows(): Row[] {
    const last = rows[rows.length - 1];
    return row === rows.length - 1 && last.len === 0 ? rows.slice(0, -1) : rows;
  }

  function toLine(r: Row): Line {
    if (r.segs.every((s) => s.sgr === "")) return r.segs.map((s) => s.text).join("");
    return r.segs.map((s): Segment => [s.text, s.sgr]);
  }

  return {
    write,
    tail(count) {
      const visible = visibleRows();
      return { lines: visible.slice(-count).map(toLine), total: dropped + visible.length };
    },
    text() {
      return visibleRows().map((r) => r.segs.map((s) => s.text).join("")).join("\n");
    },
    get dropped() {
      return dropped;
    },
    note(text) {
      if (rows[rows.length - 1].len > 0) rows.push(emptyRow());
      rows[rows.length - 1] = { segs: [{ text, len: codePoints(text), sgr: "2" }], len: codePoints(text), clamped: false };
      rows.push(emptyRow());
      row = rows.length - 1;
      col = 0;
      trimRows();
    },
  };
}

function clampByte(n: number): number {
  return Number.isNaN(n) ? 0 : Math.min(255, Math.max(0, n));
}

function codePoints(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

// The longest suffix of `lines` whose JSON stays within `maxBytes` (UTF-8 bytes of
// JSON.stringify). A single line bigger than the whole budget is cut from its front.
export function fitLines(lines: readonly Line[], maxBytes: number): Line[] {
  if (lines.length === 0 || maxBytes <= 4) return [];
  let used = 2;
  let start = lines.length;
  while (start > 0) {
    const cost = jsonBytes(lines[start - 1]) + (start === lines.length ? 0 : 1);
    if (used + cost > maxBytes) break;
    used += cost;
    start--;
  }
  if (start === lines.length && lines.length > 0) return [cutFront(lines[lines.length - 1], maxBytes - 2)];
  return lines.slice(start);
}

// The longest suffix of one line that fits, styles kept.
function cutFront(line: Line, maxBytes: number): Line {
  const list: Segment[] = typeof line === "string" ? [...line].map((ch) => [ch, ""]) : line.flatMap((seg): Segment[] => [...seg[0]].map((ch) => [ch, seg[1]]));
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (jsonBytes(implode(list.slice(list.length - mid))) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return implode(list.slice(list.length - lo));
}

function implode(list: Segment[]): Line {
  const segs: Segment[] = [];
  for (const [ch, sgr] of list) {
    const last = segs[segs.length - 1];
    if (last && last[1] === sgr) last[0] += ch;
    else segs.push([ch, sgr]);
  }
  if (segs.every((s) => s[1] === "")) return segs.map((s) => s[0]).join("");
  return segs;
}

// NUL anywhere, or more than a tenth of the chunk being control bytes that are not
// text or escapes, means the command is printing something that is not text.
export function looksBinary(text: string): boolean {
  if (text.includes("\0")) return true;
  let control = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x08 && c !== 0x1b && c !== 0x07) control++;
  }
  return text.length > 0 && control / text.length > 0.1;
}
