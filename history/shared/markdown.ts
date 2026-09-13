import { Marked, type Token, type TokenizerExtension } from "marked";

const memoryCitation: TokenizerExtension = {
  name: "memory_citation",
  level: "block",
  tokenizer(source) {
    const match = /^<oai-mem-citation>[\s\S]*?(?:<\/oai-mem-citation>|$)/.exec(source);
    return match ? { type: "memory_citation", raw: match[0] } : undefined;
  },
};

// Tokenize only: never generate or inject HTML. Fenced/inline code is consumed
// as code, so literal examples of citation markup remain visible there.
const markdown = new Marked({ gfm: true, extensions: [memoryCitation, {
  ...memoryCitation, level: "inline", start: (source) => source.indexOf("<oai-mem-citation>"),
}] });

export function markdownTokens(source: string): Token[] {
  return markdown.lexer(source);
}

export function linkAction(href: string): "open" | "copy" {
  return /^(?:https?:\/\/|mailto:)[^\s\u0000-\u001f]+$/i.test(href) ? "open" : "copy";
}
