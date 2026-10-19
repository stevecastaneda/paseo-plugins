import assert from "node:assert/strict";
import { StringDecoder } from "node:string_decoder";
import { test } from "node:test";
import { plainText, type Line } from "../shared/row.ts";
import { createScreen, fitLines, jsonBytes, looksBinary } from "./screen.ts";

const ESC = "\x1b";

function lines(input: string | string[], count = 50): Line[] {
  const screen = createScreen();
  for (const chunk of Array.isArray(input) ? input : [input]) screen.write(chunk);
  return screen.tail(count).lines;
}

test("carriage return overwrites in place, as a progress bar expects", () => {
  const cases: Array<[string, string[]]> = [
    ["a\rb", ["b"]],
    ["hello\rHE", ["HEllo"]],
    ["[=    ]\r[==   ]\r[===  ]\r[==== ]\r[=====]\n", ["[=====]"]],
    ["one\ntwo\n", ["one", "two"]],
    ["abc\b\bX", ["aXc"]],
    ["a\tb", ["a       b"]],
  ];
  for (const [input, expected] of cases) assert.deepEqual(lines(input), expected, JSON.stringify(input));
});

test("erase-line and cursor-up redraws replace lines instead of piling up", () => {
  assert.deepEqual(lines(`frame 1${ESC}[2K\rframe 2${ESC}[2K\rframe 3\n`), ["frame 3"]);
  // docker-style: three layer lines, updated twice.
  const block = (n: number) => `layer a: ${n}%\nlayer b: ${n}%\nlayer c: ${n}%\n`;
  const redraw = `${ESC}[3A${ESC}[0J`;
  assert.deepEqual(lines(block(10) + redraw + block(50) + redraw + block(100)), ["layer a: 100%", "layer b: 100%", "layer c: 100%"]);
  // Erase to the right keeps what was typed before the cursor.
  assert.deepEqual(lines(`abcdef\r${ESC}[3C${ESC}[K`), ["abc"]);
  // Erase to the left blanks what was typed before the cursor.
  assert.deepEqual(lines(`abcdef${ESC}[4D${ESC}[1K`), ["   def"]);
});

test("clear screen plus home leaves only the latest frame", () => {
  assert.deepEqual(lines(`old 1\nold 2\n${ESC}[2J${ESC}[3J${ESC}[Hnew\n`), ["new"]);
});

test("escape sequences and UTF-8 split across writes parse like one write", () => {
  assert.deepEqual(lines([`${ESC}[1;3`, "1mred", `${ESC}[`, "0m plain"]), [[["red", "1;31"], [" plain", ""]]]);
  const emoji = Buffer.from("héllo 🎉\n", "utf8");
  const decoder = new StringDecoder("utf8");
  const screen = createScreen();
  screen.write(decoder.write(emoji.subarray(0, 2)));
  screen.write(decoder.write(emoji.subarray(2, 9)));
  screen.write(decoder.write(emoji.subarray(9)));
  assert.deepEqual(screen.tail(5).lines, ["héllo 🎉"]);
});

test("styles become canonical SGR strings; order of parameters does not matter", () => {
  assert.deepEqual(lines(`${ESC}[1;31mfoo${ESC}[0mbar`), [[["foo", "1;31"], ["bar", ""]]]);
  assert.deepEqual(lines(`${ESC}[31;1mfoo`), [[["foo", "1;31"]]]);
  assert.deepEqual(lines(`${ESC}[38;5;208mx${ESC}[48;2;10;20;30my`), [[["x", "38;5;208"], ["y", "38;5;208;48;2;10;20;30"]]]);
  // Unknown parameters are ignored; attribute-off codes work.
  assert.deepEqual(lines(`${ESC}[1;4;99mx${ESC}[22my${ESC}[24mz`), [[["x", "1;4"], ["y", "4"], ["z", ""]]]);
  // Bright and background colors, inverse.
  assert.deepEqual(lines(`${ESC}[92;7mok${ESC}[m`), [[["ok", "7;92"]]]);
});

test("OSC links keep their text, unknown escapes and C0 junk are dropped", () => {
  assert.deepEqual(lines(`${ESC}]8;;https://x.test\x07click${ESC}]8;;\x07 here`), ["click here"]);
  assert.deepEqual(lines(`${ESC}]0;title${ESC}\\text`), ["text"]);
  assert.deepEqual(lines(`${ESC}(B${ESC}[?25l${ESC}[?2004hvisible${ESC}[?25h`), ["visible"]);
  assert.deepEqual(lines("a\x01b\x7fc\x0e"), ["abc"]);
});

test("a huge line is clamped once with a marker; the line budget keeps the newest lines and counts the rest", () => {
  const screen = createScreen({ maxLines: 10_000, maxLineChars: 4_000 });
  screen.write("x".repeat(1_000_000) + "\n");
  const [only] = screen.tail(1).lines as string[];
  assert.equal(only.length, 4_001);
  assert.ok(only.endsWith("…"));
  const many = createScreen({ maxLines: 10_000, maxLineChars: 4_000 });
  for (let i = 0; i < 20_000; i++) many.write(`line ${i}\n`);
  const tail = many.tail(2);
  assert.deepEqual(tail.lines, ["line 19998", "line 19999"]);
  assert.equal(tail.total, 20_000);
  assert.equal(many.dropped, 10_000);
  assert.equal(many.text().split("\n").length, 10_000);
});

test("the trailing empty line is not a line; a note is its own dim line", () => {
  const screen = createScreen();
  screen.write("a\nb");
  assert.deepEqual(screen.tail(5), { lines: ["a", "b"], total: 2, cursor: { up: 0, col: 1 } });
  screen.note("[binary output hidden]");
  assert.deepEqual(screen.tail(5).lines, ["a", "b", [["[binary output hidden]", "2"]]]);
  screen.write("c\n");
  assert.equal(screen.text(), "a\nb\n[binary output hidden]\nc");
});

test("fitLines keeps the newest lines inside a byte budget measured as UTF-8 JSON, cutting a lone giant line from its front", () => {
  const input: Line[] = ["first", "🎉🎉🎉", [["styled", "1;31"]], "last"];
  const fitted = fitLines(input, jsonBytes(input) - 1);
  assert.deepEqual(fitted, input.slice(1));
  assert.ok(jsonBytes(fitted) <= jsonBytes(input) - 1);
  const giant: Line = [["a".repeat(5_000), "1"], ["é".repeat(5_000), "31"]];
  const [cut] = fitLines([giant], 1_000);
  assert.ok(jsonBytes([cut]) <= 1_000);
  assert.ok(plainText([cut]).endsWith("é"), "the end of the line survives");
  assert.deepEqual((cut as Array<[string, string]>).map(([, sgr]) => sgr), ["31"], "styles survive the cut");
  assert.deepEqual(fitLines([], 100), []);
});

test("binary output is detected by NUL bytes or a flood of control bytes, never by colors", () => {
  assert.equal(looksBinary("hello\0world"), true);
  assert.equal(looksBinary("\x01\x02\x03\x04abc"), true);
  assert.equal(looksBinary(`${ESC}[31mred${ESC}[0m\r\n\tok\x07`), false);
  assert.equal(looksBinary(""), false);
});

test("tail says where the cursor is, counted from the last line", () => {
  const screen = createScreen();
  screen.write("one\ntwo\nPassword: ");
  assert.deepEqual(screen.tail(10).cursor, { up: 0, col: 10 });
  screen.write("\n");
  assert.deepEqual(screen.tail(10).cursor, { up: -1, col: 0 });
  screen.write("\x1b[2A\x1b[2G");
  const { lines, cursor } = screen.tail(10);
  assert.equal(lines[lines.length - 1 - cursor!.up], "two");
  assert.equal(cursor!.col, 1);
  assert.equal(screen.tail(1).cursor, null, "above the lines sent");
});
