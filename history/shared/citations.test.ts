import { test } from "node:test";
import assert from "node:assert/strict";
import { hideCitations } from "./citations.ts";

test("drops memory citations and keeps the message around them", () => {
  const source = "**Found it.**\n\n<oai-mem-citation>\n<citation_entries>\nMEMORY.md:23-27\n</citation_entries>\n</oai-mem-citation>\n\nHere is the fix: <oai-mem-citation>MEMORY.md:4</oai-mem-citation>done.";
  assert.equal(hideCitations(source), "**Found it.**\n\nHere is the fix: done.");
});

test("drops a citation that Codex cut off before its closing tag", () => {
  assert.equal(hideCitations("Done.\n\n<oai-mem-citation>MEMORY.md:1"), "Done.");
});

test("keeps citation markup shown as code", () => {
  const tag = "<oai-mem-citation>example</oai-mem-citation>";
  const source = "```xml\n" + tag + "\n```\n\nInline `" + tag + "` too.\n\n~~~~\n```\n" + tag + "\n~~~~\n" + tag;
  assert.equal(hideCitations(source), "```xml\n" + tag + "\n```\n\nInline `" + tag + "` too.\n\n~~~~\n```\n" + tag + "\n~~~~");
});

test("leaves text without citations untouched", () => {
  const source = "Line one\n\n\n\nLine two\n";
  assert.equal(hideCitations(source), source);
});

test("collapses the blank lines a citation leaves in CRLF text", () => {
  const source = "Found it.\r\n\r\n<oai-mem-citation>MEMORY.md:4</oai-mem-citation>\r\n\r\nHere is the fix.";
  assert.equal(hideCitations(source), "Found it.\r\n\r\nHere is the fix.");
});

test("keeps blank lines inside code blocks", () => {
  const code = "```\na\n\n\n\nb\n```";
  assert.equal(hideCitations(code + "\n<oai-mem-citation>x</oai-mem-citation>"), code);
});
