import assert from "node:assert/strict";
import test from "node:test";
import { posix, win32 } from "node:path";
import { demoteHeadings, dropTitle, type FileLocation, markdownExcerpt, prepareMarkdown, previewText, textExcerpt } from "./markdown.ts";

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

const posixFile: FileLocation = { root: "/r", folder: "/r/docs", path: posix };
const prepare = (text: string, where = posixFile) => prepareMarkdown(bytes(text), false, where);
// What `[a](target)` becomes in a file in /r/docs.
const link = (target: string, where = posixFile) => prepare(`[a](${target})`, where).slice("[a](".length, -1);

test("a relative link or image points at the file's own folder", () => {
  assert.equal(prepare("[a](b.md)"), "[a](/r/docs/b.md)");
  assert.equal(prepare("![shot](img/a.png)"), "![shot](/r/docs/img/a.png)");
  assert.equal(link("./b.md"), "/r/docs/b.md");
  assert.equal(link("sub/../b.md"), "/r/docs/b.md");
  assert.equal(link("../README.md"), "/r/README.md");
  assert.equal(link("shots/"), "/r/docs/shots/", "a folder keeps its slash");
  assert.equal(prepare("A [link](b.md) and ![an image](i.png) on one line."), "A [link](/r/docs/b.md) and ![an image](/r/docs/i.png) on one line.");
});

test("a target outside the worktree, absolute, or not a file is left as written", () => {
  for (const target of ["../../out.md", "../../r2/x.md", "https://example.com/a.md", "mailto:a@b.c", "tel:123", "file:///x.md", "vscode://file/x", "data:image/png;base64,AAAA",
    "blob:x", "C:\\x.md", "C:/x.md", "/abs/b.md", "//host/b.md", "\\\\srv\\b.md", "~/b.md", "#section", "#L12", "?x=1"]) {
    assert.equal(prepare(`[a](${target})`), `[a](${target})`, target);
  }
  assert.equal(prepare("[a]()"), "[a]()");
  assert.equal(prepare("<b.md> and <https://x.y>"), "<b.md> and <https://x.y>", "autolinks aren't relative paths");
  assert.equal(prepare("See docs/b.md or `docs/b.md`."), "See docs/b.md or `docs/b.md`.", "bare paths are Paseo's to link, from the workspace");
});

test("a link keeps its fragment and loses its query; an image loses both", () => {
  assert.equal(link("b.md#L12"), "/r/docs/b.md#L12");
  assert.equal(link("b.md#L12-L20"), "/r/docs/b.md#L12-L20");
  assert.equal(link("b.md?x=1#y"), "/r/docs/b.md#y");
  assert.equal(link("b.md?x=1"), "/r/docs/b.md");
  assert.equal(prepare("![i](a.png?v=2#top)"), "![i](/r/docs/a.png)");
});

test("targets are percent-encoded so they stay one destination, cell and attribute", () => {
  assert.equal(prepare("![s](<shots/a b.png>)"), "![s](/r/docs/shots/a%20b.png)");
  assert.equal(prepare("![s](shots/a b.png)"), "![s](shots/a b.png)", "a bare target with a space isn't a link");
  assert.equal(link("b%20c.md"), "/r/docs/b%20c.md", "already encoded is decoded first, not encoded twice");
  assert.equal(link("100%.md"), "/r/docs/100%25.md", "a stray % is kept as a character");
  assert.equal(link("b\\(1\\).md"), "/r/docs/b%281%29.md");
  assert.equal(link("b(1).md"), "/r/docs/b%281%29.md");
  assert.equal(link("<x y|z.md>"), "/r/docs/x%20y%7Cz.md");
  assert.equal(link("<a\"b'c&d.md>"), "/r/docs/a%22b%27c%26d.md");
  assert.equal(link("sub/notes:12.md"), "/r/docs/sub/notes%3A12.md", "a colon would read as a line number");
  assert.equal(link("Мои/x.png"), "/r/docs/%D0%9C%D0%BE%D0%B8/x.png");
  assert.equal(link("b.md#sec tion".replace(" ", "%20")), "/r/docs/b.md#sec%20tion");
  assert.equal(link("b.md", { ...posixFile, folder: "/r/my docs (old)" }), "/r/my%20docs%20%28old%29/b.md", "the folder is encoded too");
  assert.equal(prepare("| [a](<x y.md>) | b |"), "| [a](/r/docs/x%20y.md) | b |");
});

test("titles, nested images and brackets in link text survive the rewrite", () => {
  assert.equal(prepare('[a](b.md "Title")'), '[a](/r/docs/b.md "Title")');
  assert.equal(prepare("[a](b.md 'Title')"), "[a](/r/docs/b.md 'Title')");
  assert.equal(prepare("[a](b.md (Title))"), "[a](/r/docs/b.md (Title))");
  assert.equal(prepare("[![i](i.png)](b.md)"), "[![i](/r/docs/i.png)](/r/docs/b.md)");
  assert.equal(prepare("[a [b] c](d.md)"), "[a [b] c](/r/docs/d.md)");
  assert.equal(prepare("[two\nlines](d.md)"), "[two\nlines](/r/docs/d.md)");
  assert.equal(prepare("\\[a](b.md) and a](b.md)"), "\\[a](b.md) and a](b.md)", "no opening bracket, no link");
  assert.equal(prepare("[a](b.md"), "[a](b.md", "an unclosed link is text");
});

test("reference definitions point at the folder; footnotes and look-alikes in a paragraph don't", () => {
  assert.equal(prepare('[x]: b.md "T"'), '[x]: /r/docs/b.md "T"');
  assert.equal(prepare("[x]: <b c.md>"), "[x]: /r/docs/b%20c.md");
  assert.equal(prepare("> [x]: b.md"), "> [x]: /r/docs/b.md");
  assert.equal(prepare("Use [x][] here.\n\n[x]: b.md\n[y]: c.md"), "Use [x][] here.\n\n[x]: /r/docs/b.md\n[y]: /r/docs/c.md");
  assert.equal(prepare("[^1]: b.md"), "[^1]: b.md");
  assert.equal(prepare("A paragraph\n[x]: b.md"), "A paragraph\n[x]: b.md", "a definition can't interrupt a paragraph");
  assert.equal(prepare("[x]: b.md trailing words"), "[x]: b.md trailing words");
});

test("HTML images and links point at the folder too, in whatever quotes they use", () => {
  assert.equal(prepare('<img src="a.png" alt="x">'), '<img src="/r/docs/a.png" alt="x">');
  assert.equal(prepare("<img alt='x' src='a b.png'>"), "<img alt='x' src='/r/docs/a%20b.png'>");
  assert.equal(prepare("<img src=a.png width=200>"), "<img src=/r/docs/a.png width=200>");
  assert.equal(prepare('<a href="b.md#L3">b</a>'), '<a href="/r/docs/b.md#L3">b</a>');
  assert.equal(prepare('<img srcset="a.png 2x" src="https://x.y/a.png">'), '<img srcset="a.png 2x" src="https://x.y/a.png">');
  assert.equal(prepare('<p align="center">\n  <img src="a.png">\n</p>'), '<p align="center">\n  <img src="/r/docs/a.png">\n</p>');
  assert.equal(prepare("[a](<img src=b.png>)"), "[a](/r/docs/img%20src%3Db.png)", "a target that looks like a tag is rewritten once");
});

test("nothing inside code or a comment changes", () => {
  const untouched = [
    "```\n[a](b.md)\n```",
    "~~~md\n[a](b.md)\n~~~",
    "````\n```\n[a](b.md)\n```\n````",
    "> ```\n> [a](b.md)\n> ```",
    "- item\n\n  ```\n  [a](b.md)\n  ```",
    "Text\n\n    [a](b.md)",
    "`[a](b.md)`",
    "``x ` [a](b.md)``",
    "<!-- [a](b.md) -->",
    "<!--\n[a](b.md)\n![i](i.png)\n-->",
    '`<img src="a.png">`',
  ];
  for (const text of untouched) assert.equal(prepare(text), text, text);
  assert.equal(prepare("`a` [x](b.md) `c`"), "`a` [x](/r/docs/b.md) `c`", "only the code spans are code");
  assert.equal(prepare("a ` stray [x](b.md)"), "a ` stray [x](/r/docs/b.md)", "an unpaired backtick is a character");
  assert.equal(prepare("```\ncode\n```\n[a](b.md)"), "```\ncode\n```\n[a](/r/docs/b.md)", "after the fence closes");
  assert.equal(prepare("<!-- note -->\n[a](b.md)"), "<!-- note -->\n[a](/r/docs/b.md)");
  assert.equal(prepare("- item\n\n    [a](b.md)"), "- item\n\n    [a](/r/docs/b.md)", "an indented line in a list continues the item");
  assert.equal(prepare("- item\n  ```\n  code\nafter [a](b.md)"), "- item\n  ```\n  code\nafter [a](/r/docs/b.md)", "leaving the list item ends its fence");
  assert.equal(prepare("> ```\n> code\n\n[a](b.md)"), "> ```\n> code\n\n[a](/r/docs/b.md)", "leaving the quote ends its fence");
});

test("a file on a Windows daemon gets Windows paths, written with forward slashes", () => {
  const windows: FileLocation = { root: "C:\\r", folder: "C:\\r\\docs", path: win32 };
  assert.equal(link("b.md", windows), "C:/r/docs/b.md");
  assert.equal(link("..\\b.md", windows), "C:/r/b.md");
  assert.equal(link("img/a b.png".replace(" ", "%20"), windows), "C:/r/docs/img/a%20b.png");
  assert.equal(link("../../x.md", windows), "../../x.md", "outside the worktree");
  assert.equal(link("D:/x.md", windows), "D:/x.md");
  const share: FileLocation = { root: "\\\\srv\\share\\r", folder: "\\\\srv\\share\\r\\docs", path: win32 };
  assert.equal(link("b.md", share), "b.md", "Paseo would read //srv as a web address");
  assert.equal(link("b\\c.md"), "/r/docs/b%5Cc.md", "on a POSIX daemon a backslash is part of the name");
});

test("front matter shows as YAML, and line endings and a BOM don't get in the way", () => {
  assert.equal(prepare("---\ntitle: x\ntags: [a]\n---\n# Doc\n"), "```yaml\ntitle: x\ntags: [a]\n```\n# Doc\n");
  assert.equal(prepare("---\nnote: |\n  ```\n  code\n  ```\n...\nBody"), "````yaml\nnote: |\n  ```\n  code\n  ```\n````\nBody", "a fence inside is kept inside");
  assert.equal(prepare("---\ntitle: x\n# never closed"), "---\ntitle: x\n# never closed");
  assert.equal(prepare("Text\n\n---\n\nMore\n---\n"), "Text\n\n---\n\nMore\n---\n", "a rule later on is a rule");
  assert.equal(prepare("\uFEFF# T\r\n[a](b.md)\r\n"), "# T\n[a](/r/docs/b.md)\n");
});

test("a cut Markdown file ends on a whole line, inside a fence or a table if that's where it stopped", () => {
  const cut = (text: string, count: number) => prepareMarkdown(head(text, count), true, posixFile);
  assert.equal(cut("[a](b.md)\n[c](long-name.md)", 15), "[a](/r/docs/b.md)\n", "no half link is rewritten");
  assert.equal(cut("Intro\n```js\nconst a = 1;\nconst b = 2;\n```\n", 26), "Intro\n```js\nconst a = 1;\n", "the open fence runs to the end, as CommonMark draws it");
  assert.equal(cut("| a |\n|---|\n| [x](b.md) |\n| y |", 28), "| a |\n|---|\n| [x](/r/docs/b.md) |\n");
});

test("rewriting a rewritten file changes nothing", () => {
  const source = [
    "---", "title: x", "---", "# Doc", "", "[a](b.md#L1) ![i](<i 1.png>) [r][x]", "", "[x]: ../c.md 'T'", "", '<img src="d.png"> <a href=e.md>e</a>',
    "", "```", "[k](k.md)", "```", "", "| [t](Мои/t.md) |", "|---|",
  ].join("\n");
  const once = prepare(source);
  assert.notEqual(once, source);
  assert.equal(prepare(once), once);
  const windows: FileLocation = { root: "C:\\r", folder: "C:\\r\\docs", path: win32 };
  assert.equal(prepare(prepare(source, windows), windows), prepare(source, windows));
});

const writeUp = [
  "# Ticket 01: Login",
  "",
  "Let people sign in with **email** and a [magic link](https://example.com/a/very/long/address/that/does/not/count/toward/the/budget).",
  "",
  "## Acceptance",
  "",
  "1. Sends the link within a minute, to the address the person typed in the form.",
  "2. The link works once, and only for fifteen minutes after it was sent out.",
  "3. A used or expired link explains what happened and offers to send another one.",
  "",
  "See [the design][design].",
  "",
  "[design]: /r/docs/design.md",
].join("\n");

test("a write-up excerpt drops the title and stops after whole blocks", () => {
  const short = markdownExcerpt(writeUp, 280);
  assert.equal(short.more, true);
  assert.ok(!short.text.includes("Ticket 01"), "the title is the ticket's own");
  assert.ok(short.text.startsWith("Let people sign in"));
  assert.ok(short.text.includes("2. The link works once") && !short.text.includes("3. A used"), "cut after a whole list item, numbering kept");
  assert.ok(short.text.endsWith("\n\n[design]: /r/docs/design.md"), "reference definitions come along");
  const whole = markdownExcerpt(writeUp, 2000);
  assert.deepEqual(whole, { text: writeUp.slice("# Ticket 01: Login\n\n".length), more: false });
});

test("a write-up excerpt keeps its first block, cuts a long one at a line, and leaves no heading last", () => {
  const paragraph = "word ".repeat(600).trim();
  assert.deepEqual(markdownExcerpt(`# T\n\n${paragraph}\n\nNext.`, 280), { text: paragraph, more: true }, "a long first line shows whole");
  const code = ["```sh", ...Array.from({ length: 200 }, (_, index) => `echo line ${index}`), "```", "", "After."].join("\n");
  const excerpt = markdownExcerpt(code, 280);
  assert.equal(excerpt.more, true);
  assert.ok(excerpt.text.startsWith("```sh\necho line 0\n") && excerpt.text.endsWith("\n```") && excerpt.text.length < 400, "its first lines, with the fence closed");
  assert.deepEqual(markdownExcerpt("Intro sentence.\n\n## Details\n\n" + "More text here. ".repeat(30), 280), { text: "Intro sentence.", more: true }, "no heading left hanging");
  assert.deepEqual(markdownExcerpt("![one](/a.png)\n\n![two](/b.png)", 280), { text: "![one](/a.png)", more: true }, "one image at most");
  assert.deepEqual(markdownExcerpt("# Only a title", 280), { text: "", more: false });
  assert.deepEqual(markdownExcerpt("```yaml\nid: 1\n```\n\n# Title\n\nBody", 280), { text: "Body", more: false }, "front matter stays out of the excerpt");
});

test("a write-up's title comes off whatever its form, and other headings stay", () => {
  assert.equal(dropTitle("Title\n=====\n\nBody"), "Body");
  assert.equal(dropTitle("\n# Title #\nBody"), "\nBody");
  assert.equal(dropTitle("```yaml\nid: 1\n```\n\n# Title\n\nBody"), "```yaml\nid: 1\n```\n\nBody", "after front matter");
  assert.equal(dropTitle("## Section\n\nBody"), "## Section\n\nBody");
  assert.equal(dropTitle("Body first\n\n# Title"), "Body first\n\n# Title");
  assert.equal(dropTitle("- item\n=\n"), "- item\n=\n");
});

test("a write-up's headings all draw at one small level, outside code", () => {
  assert.equal(demoteHeadings("# A\n## B\n### C #\n> ## Quoted\nText #1\n```\n# comment\n```\n    # indented", 5),
    "##### A\n##### B\n##### C #\n> ##### Quoted\nText #1\n```\n# comment\n```\n    # indented");
  assert.equal(demoteHeadings("#hashtag", 5), "#hashtag");
});

test("a plain-text write-up shows whole lines up to the budget", () => {
  assert.deepEqual(textExcerpt("short\nnote\n", 280), { text: "short\nnote", more: false });
  const log = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
  const excerpt = textExcerpt(log, 50);
  assert.equal(excerpt.more, true);
  assert.ok(log.startsWith(excerpt.text) && excerpt.text.length <= 50 && log[excerpt.text.length] === "\n");
  assert.deepEqual(textExcerpt("one very long line ".repeat(30), 50), { text: "one very long line one very long line one very…", more: true });
});
