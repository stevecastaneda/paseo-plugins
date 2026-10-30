// Progress's own Markdown (its skill in Settings, What's new) as simple blocks
// drawn in Progress's own type: headings, paragraphs, list items and code.
// Inline marks are kept as spans: `code` stays code, **bold** stays bold,
// _emphasis_ loses its markers, and [links](url) keep only their text.

export type Span = { text: string; code?: boolean; strong?: boolean };

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
    part.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").split(/((?:\*\*|__).+?(?:\*\*|__))/).forEach((piece) => {
      if (!piece) return;
      const strong = /^(\*\*|__).+\1$/.test(piece);
      const text = (strong ? piece.slice(2, -2) : piece).replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,;:!?]|$)/g, "$1$2");
      result.push(strong ? { text, strong } : { text });
    });
  });
  return result;
}

export function parseWriteUp(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  // A fence opened inside a list item is indented like the item; its lines
  // lose up to that much indentation.
  let fence: { indent: number; lines: string[] } | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", spans: spans(paragraph.join(" ")) });
    paragraph = [];
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence) {
      if (/^\s*(```|~~~)/.test(raw)) {
        blocks.push({ kind: "code", text: fence.lines.join("\n") });
        fence = null;
      } else fence.lines.push(raw.replace(new RegExp(`^[ \\t]{0,${fence.indent}}`), ""));
      continue;
    }
    if (/^\s*(```|~~~)/.test(raw)) {
      flush();
      fence = { indent: /^[ \t]*/.exec(raw)![0].length, lines: [] };
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
  if (fence) blocks.push({ kind: "code", text: fence.lines.join("\n") });
  return blocks;
}

// Without a leading top heading, which only repeats the screen's own title.
export function withoutTitle(blocks: Block[]): Block[] {
  return blocks[0]?.kind === "heading" && blocks[0].level === 1 ? blocks.slice(1) : blocks;
}
