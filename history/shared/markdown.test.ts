import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownTokens, linkAction } from "./markdown.ts";

test("recognizes formatting and hides citation metadata without changing the source", () => {
  const source = '**Yes—this is feasible.**\n\n- **Pill:** supported.\n- `code` and [docs](https://paseo.sh)\n\n<oai-mem-citation>\n<citation_entries>\nMEMORY.md:23-27\n\nmore metadata\n</citation_entries>\n</oai-mem-citation>';
  const tokens = markdownTokens(source);
  assert.equal(tokens[0]!.type, "paragraph");
  assert.equal(tokens[0]!.tokens[0].type, "strong");
  assert.ok(tokens.some((token) => token.type === "list"));
  assert.ok(tokens.some((token) => token.type === "memory_citation"));
  assert.equal(tokens.map((token) => token.raw).join(""), source);
});

test("preserves literal citation markup in fenced and inline code", () => {
  const text = '<oai-mem-citation>example</oai-mem-citation>';
  const tokens = markdownTokens('```xml\n' + text + '\n```\n\n`' + text + '`');
  assert.equal(tokens[0]!.type, "code");
  assert.equal(tokens[0]!.text, text);
  assert.equal(tokens[2]!.tokens[0].type, "codespan");
  assert.equal(tokens[2]!.tokens[0].text, text);
});

test("only opens ordinary web/mail links; local paths and executable schemes are copy-only", () => {
  assert.equal(linkAction("https://paseo.sh/docs"), "open");
  assert.equal(linkAction("mailto:hello@example.com"), "open");
  for (const href of ["javascript:alert(1)", "data:text/html,hello", "/tmp/report.md", "paseo://app", "https://x\nunsafe"]) {
    assert.equal(linkAction(href), "copy");
  }
});
