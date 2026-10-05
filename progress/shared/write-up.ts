// A ticket's write-up (its Markdown source file) as simple blocks the dialog
// can draw without a Markdown renderer: headings, paragraphs, list items and
// code. Inline marks are kept as spans: `code` stays code, **bold** and
// _emphasis_ lose their markers, and [links](url) keep only their text.

export type Span = { text: string; code?: boolean };

export type Block =
  | { kind: "heading"; level: number; spans: Span[] }
  | { kind: "paragraph"; spans: Span[] }
  // `marker` is "•" for bullets, "1." and so on for numbered items, "☐"/"☑" for tasks.
  | { kind: "item"; marker: string; depth: number; spans: Span[] }
  | { kind: "code"; text: string };

export function spans(text: string): Span[] {
  const result: Span[] = [];
  text.split(/(`[^`]+`)/).forEach((part) => {
    if (!part) return;
    if (/^`[^`]+`$/.test(part)) {
      result.push({ text: part.slice(1, -1), code: true });
      return;
    }
    const plain = part
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,;:!?]|$)/g, "$1$2");
    result.push({ text: plain });
  });
  return result;
}

export function parseWriteUp(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let fence: string[] | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", spans: spans(paragraph.join(" ")) });
    paragraph = [];
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence) {
      if (/^\s*(```|~~~)/.test(raw)) {
        blocks.push({ kind: "code", text: fence.join("\n") });
        fence = null;
      } else fence.push(raw);
      continue;
    }
    if (/^\s*(```|~~~)/.test(raw)) {
      flush();
      fence = [];
      continue;
    }
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    const item = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
    if (!line.trim() || /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) flush();
    else if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, spans: spans(heading[2]) });
    } else if (item) {
      flush();
      const marker = item[3] !== undefined ? (item[3] === " " ? "☐" : "☑") : /\d/.test(item[2]) ? item[2].replace(")", ".") : "•";
      blocks.push({ kind: "item", marker, depth: Math.floor(item[1].replace(/\t/g, "  ").length / 2), spans: spans(item[4]) });
    } else if (/^\s{2,}\S/.test(line) && blocks.at(-1)?.kind === "item" && !paragraph.length) {
      // A wrapped list item continues on an indented line.
      const last = blocks.at(-1) as Extract<Block, { kind: "item" }>;
      last.spans = [...last.spans, ...spans(` ${line.trim()}`)];
    } else paragraph.push(line.trim().replace(/^>\s?/, ""));
  }
  flush();
  if (fence) blocks.push({ kind: "code", text: fence.join("\n") });
  return blocks;
}

// The write-up without a leading top heading, which only repeats the ticket's title.
export function withoutTitle(blocks: Block[]): Block[] {
  return blocks[0]?.kind === "heading" && blocks[0].level === 1 ? blocks.slice(1) : blocks;
}

// The first blocks of the write-up, up to about `maxChars` of text, for the excerpt.
export function writeUpExcerpt(blocks: Block[], maxChars = 420): { blocks: Block[]; more: boolean } {
  const body = withoutTitle(blocks);
  const shown: Block[] = [];
  let chars = 0;
  for (const block of body) {
    const length = block.kind === "code" ? block.text.length : block.spans.reduce((sum, span) => sum + span.text.length, 0);
    if (shown.length && chars + length > maxChars) break;
    shown.push(block);
    chars += length;
  }
  return { blocks: shown, more: shown.length < body.length };
}
