// Text files as the preview dialog gets them. A Markdown file also has its
// relative links and images pointed at its own folder, because Paseo's Markdown
// resolves them from the workspace and plugins can't tell it otherwise. One line
// scanner decides what is code, so a link in a code block is never touched.
import type { PlatformPath } from "node:path";

// How far back from a cut to look for a line break. A file with none that close
// (minified, or one long line) is cut mid-line rather than lose that much.
const LINE_SEARCH_BYTES = 8 * 1024;

// The text of the first bytes of a file. When the file goes on past them, the
// text ends after its last whole line, so the preview never ends on half a
// character, half a table row or half a link.
export function previewText(bytes: Uint8Array, truncated: boolean): string {
  return new TextDecoder().decode(truncated ? cleanCut(bytes) : bytes);
}

function cleanCut(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  // Back over UTF-8 continuation bytes to the last character's first byte, and
  // drop that character when the cut left it short.
  for (let back = 1; back <= Math.min(4, end); back++) {
    const byte = bytes[end - back];
    if ((byte & 0xc0) === 0x80) continue;
    const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    if (length > back) end -= back;
    break;
  }
  const newline = end ? bytes.lastIndexOf(0x0a, end - 1) : -1;
  if (newline >= 0 && end - (newline + 1) <= LINE_SEARCH_BYTES) end = newline + 1;
  return bytes.subarray(0, end);
}

// Where a Markdown file sits, in the daemon's own path format: `path` is the
// daemon's node:path. Targets that resolve outside `root` are left as written.
export interface FileLocation {
  root: string;
  folder: string;
  path: Pick<PlatformPath, "resolve" | "relative" | "isAbsolute" | "sep">;
}

// A Markdown file's first bytes as Paseo's Markdown should get them: cut like
// any text, front matter shown as YAML (otherwise it draws as a rule and a
// heading), and every relative link and image made absolute against its folder.
export function prepareMarkdown(bytes: Uint8Array, truncated: boolean, where: FileLocation): string {
  const text = previewText(bytes, truncated).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  return rewriteTargets(fenceFrontMatter(text), where);
}

function fenceFrontMatter(text: string): string {
  const close = /^(?:---|\.\.\.)[ \t]*$/m;
  const open = /^---[ \t]*\n/.exec(text);
  if (!open) return text;
  const end = close.exec(text.slice(open[0].length));
  if (!end) return text;
  const body = text.slice(open[0].length, open[0].length + end.index);
  const fence = "`".repeat(Math.max(3, ...Array.from(body.matchAll(/^[ \t]*(`+)/gm), (match) => match[1].length + 1)));
  return `${fence}yaml\n${body}${fence}${text.slice(open[0].length + end.index + end[0].length)}`;
}

type LineKind = "blank" | "text" | "fence-open" | "fence-body" | "fence-close" | "indented-code" | "comment";

interface Line {
  // Offsets into the source; `end` is the line break or the end of the source.
  start: number;
  end: number;
  kind: LineKind;
  // Starts a list item that isn't nested in another.
  item: boolean;
  // A reference definition, `[label]: target`, which draws nothing.
  definition: boolean;
  // An ATX heading's level, 0 for anything else.
  heading: number;
}

// The code a fence opened: closed by the same character run, or ended early by
// leaving the quote or list item it sits in.
type Fence = { run: string; quotes: number; indent: number };

const QUOTES = /^(?:[ ]{0,3}>[ ]?)*/;
const FENCE = /^[ \t]*(`{3,}(?=[^`]*$)|~{3,})/;
const ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const DEFINITION = /^ {0,3}\[(?!\^)(?:[^\\\]]|\\.)+\]:/;

// Each line of LF text, by what it is. A small state machine: inside a fence,
// inside an HTML comment, or in a list (where indented lines continue an item
// instead of being code).
function scanLines(source: string): Line[] {
  const lines: Line[] = [];
  let fence: Fence | null = null;
  let comment = false;
  let list = false;
  let previous: Line | undefined;
  for (let start = 0; start <= source.length;) {
    const newline = source.indexOf("\n", start);
    const end = newline < 0 ? source.length : newline;
    const raw = source.slice(start, end);
    const quotePrefix = QUOTES.exec(raw)![0];
    const quotes = quotePrefix.split(">").length - 1;
    const rest = raw.slice(quotePrefix.length);
    const blank = !rest.trim();
    const indent = indentOf(rest);
    const line: Line = { start, end, kind: "text", item: false, definition: false, heading: 0 };
    if (fence && (quotes < fence.quotes || (!blank && indent < fence.indent))) fence = null;
    if (fence) {
      const close = FENCE.exec(rest);
      const closes = close !== null && rest.trim() === close[1] && close[1][0] === fence.run[0] && close[1].length >= fence.run.length;
      line.kind = closes ? "fence-close" : "fence-body";
      if (closes) fence = null;
    } else if (comment) {
      line.kind = "comment";
      comment = !raw.includes("-->") || codeMask(raw.slice(raw.lastIndexOf("-->") + 3)).comment;
    } else if (blank) {
      line.kind = "blank";
    } else {
      const item = ITEM.test(rest);
      const heading = /^ {0,3}(#{1,6})(?:[ \t]|$)/.exec(rest)?.[1].length ?? 0;
      if (list && indent === 0 && !item && (previous?.kind === "blank" || heading)) list = false;
      const paragraphAbove = previous?.kind === "text" && !previous.heading && !previous.definition;
      if (indent >= 4 && !list && !paragraphAbove) line.kind = "indented-code";
      else if (FENCE.test(rest) && (indent < 4 || list)) {
        line.kind = "fence-open";
        fence = { run: FENCE.exec(rest)![1], quotes, indent: list ? indent : 0 };
      } else {
        if (item) list = true;
        line.item = item && quotes === 0 && indent < 2;
        line.heading = heading;
        line.definition = DEFINITION.test(rest) && !paragraphAbove;
        comment = codeMask(raw).comment;
      }
    }
    lines.push(line);
    previous = line;
    start = end + 1;
  }
  return lines;
}

function indentOf(text: string): number {
  let columns = 0;
  for (const character of text) {
    if (character === " ") columns++;
    else if (character === "\t") columns += 4 - (columns % 4);
    else break;
  }
  return columns;
}

// Which characters of a run of text lines are inline code or an HTML comment,
// and whether the text ends inside an unclosed comment. Backtick runs pair with
// the next run of the same length; one without a partner is literal.
function codeMask(text: string): { mask: Uint8Array; comment: boolean } {
  const mask = new Uint8Array(text.length);
  for (let index = 0; index < text.length;) {
    if (text[index] === "\\") {
      index += 2;
    } else if (text[index] === "`") {
      const run = runLength(text, index);
      let close = text.indexOf("`", index + run);
      while (close >= 0 && runLength(text, close) !== run) close = text.indexOf("`", close + runLength(text, close));
      if (close < 0) {
        index += run;
        continue;
      }
      mask.fill(1, index, close + run);
      index = close + run;
    } else if (text.startsWith("<!--", index)) {
      const close = text.indexOf("-->", index + 4);
      if (close < 0) {
        mask.fill(1, index);
        return { mask, comment: true };
      }
      mask.fill(1, index, close + 3);
      index = close + 3;
    } else {
      index++;
    }
  }
  return { mask, comment: false };
}

function runLength(text: string, index: number): number {
  let end = index;
  while (text[end] === "`") end++;
  return end - index;
}

type Edit = { start: number; end: number; text: string };

// Inline links and images (also an image inside a link), reference definitions,
// and HTML <img src> and <a href>, which Paseo turns into Markdown first. Only the
// target changes; text and titles stay as written.
function rewriteTargets(source: string, where: FileLocation): string {
  const lines = scanLines(source);
  const edits: Edit[] = [];
  for (let first = 0; first < lines.length; first++) {
    if (lines[first].kind !== "text") continue;
    let last = first;
    while (last + 1 < lines.length && lines[last + 1].kind === "text") last++;
    const offset = lines[first].start;
    const text = source.slice(offset, lines[last].end);
    const { mask } = codeMask(text);
    const add = (start: number, end: number, target: string, image: boolean) => {
      const replacement = localTarget(target, where, image);
      if (replacement !== null) edits.push({ start: offset + start, end: offset + end, text: replacement });
    };
    inlineTargets(text, mask, add);
    for (let index = first; index <= last; index++) {
      if (!lines[index].definition) continue;
      const lineText = source.slice(lines[index].start, lines[index].end);
      const target = definitionTarget(lineText);
      if (target && !mask[lines[index].start - offset + target.start]) add(lines[index].start - offset + target.start, lines[index].start - offset + target.end, target.target, false);
    }
    for (const tag of text.matchAll(/<(img|a)\b[^>]*>/gi)) {
      if (mask[tag.index]) continue;
      const name = tag[1].toLowerCase() === "img" ? "src" : "href";
      const attribute = new RegExp(`(?<=\\s)${name}[ \\t\\n]*=[ \\t\\n]*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, "i").exec(tag[0]);
      if (!attribute) continue;
      const value = attribute[1] ?? attribute[2] ?? attribute[3];
      const start = tag.index + attribute.index + attribute[0].length - value.length - (attribute[3] === undefined ? 1 : 0);
      add(start, start + value.length, value, name === "src");
    }
    first = last;
  }
  let result = "";
  let last = 0;
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    // `[a](<img src=b.png>)` reads as both a link and a tag; the first edit wins.
    if (edit.start < last) continue;
    result += source.slice(last, edit.start) + edit.text;
    last = edit.end;
  }
  return result + source.slice(last);
}

// Each `](` that closes a link's or image's text, with the destination after it.
function inlineTargets(text: string, mask: Uint8Array, add: (start: number, end: number, target: string, image: boolean) => void) {
  for (let close = text.indexOf("]("); close >= 0; close = text.indexOf("](", close + 1)) {
    if (mask[close] || escaped(text, close)) continue;
    const open = linkOpen(text, mask, close);
    if (open < 0) continue;
    const destination = inlineDestination(text, close + 2);
    if (destination) add(destination.start, destination.end, destination.target, open > 0 && text[open - 1] === "!" && !escaped(text, open - 1));
  }
}

function linkOpen(text: string, mask: Uint8Array, close: number): number {
  let depth = 0;
  for (let index = close - 1; index >= 0; index--) {
    if (mask[index] || escaped(text, index)) continue;
    if (text[index] === "]") depth++;
    else if (text[index] === "[" && depth-- === 0) return index;
  }
  return -1;
}

function escaped(text: string, index: number): boolean {
  let slashes = 0;
  while (index - slashes - 1 >= 0 && text[index - slashes - 1] === "\\") slashes++;
  return slashes % 2 === 1;
}

// The destination of an inline link that starts at `from` (just after its `(`):
// `<...>` or a bare run with balanced parentheses, then an optional title and
// `)`. Null when that isn't a well-formed link, which Markdown shows as text.
function inlineDestination(text: string, from: number): { start: number; end: number; target: string } | null {
  let index = skipSpace(text, from);
  const start = index;
  if (text[index] === "<") {
    const close = angleEnd(text, index);
    if (close < 0) return null;
    index = close + 1;
  } else {
    let depth = 0;
    for (; index < text.length; index++) {
      const character = text[index];
      if (character === "\\" && isPunctuation(text[index + 1])) index++;
      else if (character === "(") depth++;
      else if (character === ")" && depth-- === 0) break;
      else if (/[\s\x00-\x1f]/.test(character)) break;
    }
    if (depth > 0) return null;
  }
  const end = index;
  index = skipSpace(text, index);
  if (index > end && /["'(]/.test(text[index] ?? "")) {
    index = titleEnd(text, index);
    if (index < 0) return null;
    index = skipSpace(text, index);
  }
  if (text[index] !== ")") return null;
  return { start, end, target: unescape(text[start] === "<" ? text.slice(start + 1, end - 1) : text.slice(start, end)) };
}

// A definition line's target, with its offsets in the line, if the rest of the
// line is a well-formed definition.
function definitionTarget(line: string): { start: number; end: number; target: string } | null {
  const label = DEFINITION.exec(line.slice(QUOTES.exec(line)![0].length));
  if (!label) return null;
  const start = skipSpace(line, QUOTES.exec(line)![0].length + label[0].length);
  let end = start;
  if (line[start] === "<") end = angleEnd(line, start) + 1;
  else while (end < line.length && !/\s/.test(line[end])) end++;
  if (end <= start) return null;
  const after = line.slice(end);
  if (after.trim() && !/^\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^)\\]|\\.)*\))\s*$/.test(after)) return null;
  return { start, end, target: unescape(line[start] === "<" ? line.slice(start + 1, end - 1) : line.slice(start, end)) };
}

function angleEnd(text: string, open: number): number {
  for (let index = open + 1; index < text.length; index++) {
    if (text[index] === "\\") index++;
    else if (text[index] === ">") return index;
    else if (text[index] === "<" || text[index] === "\n") return -1;
  }
  return -1;
}

function titleEnd(text: string, open: number): number {
  const close = text[open] === "(" ? ")" : text[open];
  for (let index = open + 1; index < text.length; index++) {
    if (text[index] === "\\") index++;
    else if (text[index] === close) return index + 1;
  }
  return -1;
}

function skipSpace(text: string, index: number): number {
  let newlines = 0;
  while (index < text.length && /[ \t\n]/.test(text[index]) && (text[index] !== "\n" || newlines++ === 0)) index++;
  return index;
}

function isPunctuation(character: string | undefined): boolean {
  return character !== undefined && /[!-/:-@[-`{-~]/.test(character);
}

function unescape(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

// The absolute target a relative one becomes, or null to leave it as written:
// web addresses and other schemes, anchors, and paths that are already absolute
// or home-relative. A link keeps its fragment (`#L12` jumps to a line); an
// image doesn't need one. A query never reaches a local file.
function localTarget(written: string, where: FileLocation, image: boolean): string | null {
  if (/^(?:[a-z][a-z0-9+.-]*:|[#/\\~])/i.test(written)) return null;
  const split = written.search(/[?#]/);
  const path = split < 0 ? written : written.slice(0, split);
  if (!path) return null;
  const hash = written.indexOf("#");
  const fragment = image || hash < 0 ? "" : written.slice(hash + 1);
  const { resolve, relative, isAbsolute, sep } = where.path;
  const decoded = decode(path);
  const absolute = resolve(where.folder, decoded);
  const inside = relative(where.root, absolute);
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return null;
  const folder = decoded.endsWith("/") || decoded.endsWith(sep);
  const slashed = absolute.split(sep).join("/") + (folder && !absolute.endsWith(sep) ? "/" : "");
  // Paseo reads `//server/share` as a web address, so a file on a network
  // share keeps its relative targets.
  if (slashed.startsWith("//")) return null;
  return encodeTarget(slashed) + (fragment ? `#${encodeTarget(decode(fragment))}` : "");
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// Percent-encodes everything that could end the target or change what it means
// wherever it lands: a Markdown destination, a table cell, an HTML attribute.
// A Windows drive's colon stays, so Paseo still sees `C:/`.
function encodeTarget(path: string): string {
  const drive = /^[A-Za-z]:\//.exec(path)?.[0] ?? "";
  let encoded = drive;
  for (const character of path.slice(drive.length)) {
    if (/[A-Za-z0-9\-._~!$*+,;@/]/.test(character)) encoded += character;
    else {
      const escape = encodeURIComponent(character);
      encoded += escape === character ? `%${character.charCodeAt(0).toString(16).toUpperCase()}` : escape;
    }
  }
  return encoded;
}

// Every ATX heading outside code at one level, so a write-up's headings don't
// outrank the dialog it sits in.
export function demoteHeadings(markdown: string, level: number): string {
  let result = "";
  let last = 0;
  for (const line of scanLines(markdown)) {
    if (!line.heading) continue;
    const marks = /^((?:[ ]{0,3}>[ ]?)*[ ]{0,3})#+/.exec(markdown.slice(line.start, line.end))!;
    result += markdown.slice(last, line.start + marks[1].length) + "#".repeat(level);
    last = line.start + marks[0].length;
  }
  return result + markdown.slice(last);
}

// The write-up without its leading title, which only repeats the ticket's: an
// ATX or setext level-one heading, after front matter if it has some.
export function dropTitle(markdown: string): string {
  const lines = scanLines(markdown);
  let index = lines.findIndex((line) => line.kind !== "blank");
  if (lines[index]?.kind === "fence-open" && /^```+yaml\s*$/.test(markdown.slice(lines[index].start, lines[index].end))) {
    while (index < lines.length && lines[index].kind !== "fence-close") index++;
    while (++index < lines.length && lines[index].kind === "blank");
  }
  const title = lines[index];
  if (!title || title.kind !== "text") return markdown;
  const underline = lines[index + 1]?.kind === "text" && /^ {0,3}=+[ \t]*$/.test(markdown.slice(lines[index + 1].start, lines[index + 1].end));
  if (title.heading !== 1 && (title.heading || title.item || !underline)) return markdown;
  let next = index + (underline && title.heading !== 1 ? 2 : 1);
  while (lines[next]?.kind === "blank") next++;
  return markdown.slice(0, title.start) + (next < lines.length ? markdown.slice(lines[next].start) : "");
}

type Unit = { kind: "paragraph" | "item" | "fence" | "code"; start: number; end: number; visible: number; heading: boolean; lines: Line[] };

// The start of a write-up without its title, cut after whole blocks
// (paragraphs, tables, code blocks, top-level list items) once about `maxChars`
// of visible text is in. The first block always shows; a long one is cut at a
// line. A heading left last goes, and the document's reference definitions
// come along so its reference links still work. An image counts as the whole
// budget, so an excerpt has at most one.
export function markdownExcerpt(markdown: string, maxChars: number): { text: string; more: boolean } {
  const body = dropTitle(markdown);
  const lines = scanLines(body);
  const units: Unit[] = [];
  const definitions: Line[] = [];
  let unit: Unit | null = null;
  let afterBlank = false;
  const close = () => {
    if (unit) units.push(unit);
    unit = null;
  };
  for (const line of lines) {
    const text = body.slice(line.start, line.end);
    const current = unit as Unit | null;
    const inFence = line.kind === "fence-body" || line.kind === "fence-close";
    const continues = current !== null && (
      (current.kind === "fence" && inFence)
      || (current.kind === "code" && line.kind === "indented-code")
      || (current.kind === "item" && !line.item && line.kind !== "blank" && (inFence || indentOf(text) >= 2 || (!afterBlank && line.kind === "text" && !line.heading)))
      || (current.kind === "paragraph" && line.kind === "text" && !line.heading && !line.item && !line.definition));
    if (continues) {
      current.end = line.end;
      current.lines.push(line);
      if (current.kind === "fence" && line.kind === "fence-close") close();
    } else if (line.definition) {
      definitions.push(line);
    } else if (line.kind === "blank") {
      if (current?.kind === "paragraph" || current?.kind === "fence") close();
    } else if (line.kind !== "comment") {
      close();
      const kind = line.kind === "fence-open" || inFence ? "fence" : line.kind === "indented-code" ? "code" : line.item ? "item" : "paragraph";
      unit = { kind, start: line.start, end: line.end, visible: 0, heading: line.heading > 0, lines: [line] };
      if (line.heading) close();
    }
    afterBlank = line.kind === "blank";
  }
  close();
  if (!units.length) return { text: "", more: false };
  for (const each of units) each.visible = visibleLength(body, each, maxChars);
  let taken = 0;
  for (let total = 0; taken < units.length && (taken === 0 || total + units[taken].visible <= maxChars); taken++) total += units[taken].visible;
  if (taken > 1 && units[taken - 1].heading) taken--;
  const first = units[0];
  let end = units[taken - 1].end;
  let closing = "";
  if (taken === 1 && first.visible > 2 * maxChars) {
    const counted = first.kind === "fence" ? first.lines.filter((line) => line.kind === "fence-body") : first.lines;
    let kept = 0;
    for (let visible = 0; kept < counted.length; kept++) {
      visible += counted[kept].end - counted[kept].start;
      if (kept && visible > maxChars) break;
    }
    if (kept < counted.length) {
      end = counted[kept - 1].end;
      const fence = first.kind === "fence" ? /^([ \t>]*)(`{3,}|~{3,})/.exec(body.slice(first.start, first.lines[0].end)) : null;
      if (fence) closing = `\n${fence[1]}${fence[2]}`;
    }
  }
  const references = definitions.filter((line) => line.start < first.start || line.start >= end).map((line) => body.slice(line.start, line.end));
  const text = body.slice(first.start, end) + closing + (references.length ? `\n\n${references.join("\n")}` : "");
  return { text, more: taken < units.length || end < units[taken - 1].end };
}

function visibleLength(body: string, unit: Unit, maxChars: number): number {
  const text = body.slice(unit.start, unit.end);
  if (unit.kind === "fence" || unit.kind === "code") return (unit.kind === "fence" ? unit.lines.slice(1, -1) : unit.lines).reduce((sum, line) => sum + line.end - line.start, 0);
  if (/!\[[^\]]*\]\(|<img\b/i.test(text)) return maxChars;
  return text
    .replace(/<!--[\s\S]*?-->|<[^>]+>/g, "")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/^[ \t>]*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|#{1,6}[ \t]+)?/gm, "")
    .replace(/[*_`~[\]|\\]/g, "").length;
}

// The start of a plain-text write-up: whole lines up to `maxChars`, or the first
// line cut at a space when it alone is longer.
export function textExcerpt(text: string, maxChars: number): { text: string; more: boolean } {
  const whole = text.trimEnd();
  if (whole.length <= maxChars) return { text: whole, more: false };
  const line = whole.lastIndexOf("\n", maxChars);
  if (line > 0) return { text: whole.slice(0, line).trimEnd(), more: true };
  const space = whole.lastIndexOf(" ", maxChars);
  return { text: `${whole.slice(0, space > 0 ? space : maxChars)}…`, more: true };
}
