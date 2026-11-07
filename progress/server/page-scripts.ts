import { readFileSync, statSync } from "node:fs";
import { Script } from "node:vm";
import { defaultTreeAdapter, html as htmlNames, parse, type DefaultTreeAdapterTypes } from "parse5";
import { previewKind } from "../shared/attachments.ts";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type TextNode = DefaultTreeAdapterTypes.TextNode;

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_MILLISECONDS = 1000;

// The HTML standard's JavaScript MIME type essence matches. Any other type, or
// one with parameters, makes the browser treat the script as data and skip it.
const CLASSIC_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

export interface ScriptError {
  line: number;
  message: string;
}

class OutOfTime extends Error {}

// One syntax error makes the browser drop that whole script, so the page can
// open blank in Paseo's preview. parse5 finds the scripts the way a browser's
// parser does, and compiling a vm.Script parses the code without running it.
// Module scripts aren't checked, because node:vm can't parse them without a flag.
// parse5 slows down sharply on deeply nested markup, so the whole check gets a
// time limit, and reports only what it found before then.
export function scriptSyntaxErrors(html: string): ScriptError[] {
  const deadline = performance.now() + MAX_MILLISECONDS;
  const treeAdapter = {
    ...defaultTreeAdapter,
    createElement(...args: Parameters<typeof defaultTreeAdapter.createElement>) {
      if (performance.now() > deadline) throw new OutOfTime();
      return defaultTreeAdapter.createElement(...args);
    },
  };
  let document;
  try {
    document = parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: true, treeAdapter });
  } catch (error) {
    if (error instanceof OutOfTime) return [];
    throw error;
  }
  const errors: ScriptError[] = [];
  const pending: Node[] = [document];
  for (let node = pending.pop(); node && performance.now() <= deadline; node = pending.pop()) {
    if (!("childNodes" in node)) continue;
    const error = isClassicScript(node) ? compileError(node) : undefined;
    if (error) errors.push(error);
    const children = isShadowRoot(node) ? node.content.childNodes : node.childNodes;
    for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
  }
  return errors;
}

const attribute = (element: Element, name: string) => element.attrs.find((candidate) => candidate.name === name)?.value;
const stripAsciiWhitespace = (value: string) => value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");

// A declarative shadow root's scripts run with the page. Any other template's
// contents stay inert until a script copies them in.
function isShadowRoot(node: Node): node is DefaultTreeAdapterTypes.Template {
  if (node.nodeName !== "template" || !("content" in node)) return false;
  const mode = attribute(node, "shadowrootmode")?.toLowerCase();
  return mode === "open" || mode === "closed";
}

function isClassicScript(node: Node): node is Element {
  if (!("tagName" in node) || node.tagName !== "script") return false;
  if (node.namespaceURI !== htmlNames.NS.HTML && node.namespaceURI !== htmlNames.NS.SVG) return false;
  // An unclosed script runs to the end of the page, and the browser never runs it.
  if (!node.sourceCodeLocation?.endTag) return false;
  if (attribute(node, "src") !== undefined) return false;
  if (node.namespaceURI === htmlNames.NS.SVG && attribute(node, "href") !== undefined) return false;
  if (attribute(node, "nomodule") !== undefined) return false;
  const forAttribute = attribute(node, "for");
  const event = attribute(node, "event");
  if (forAttribute !== undefined && event !== undefined) {
    if (stripAsciiWhitespace(forAttribute).toLowerCase() !== "window") return false;
    if (!["onload", "onload()"].includes(stripAsciiWhitespace(event).toLowerCase())) return false;
  }
  const type = attribute(node, "type");
  const language = attribute(node, "language");
  if (type === undefined) return !language || CLASSIC_TYPES.has(`text/${language}`.toLowerCase());
  const essence = stripAsciiWhitespace(type).toLowerCase();
  return essence === "" || CLASSIC_TYPES.has(essence);
}

function compileError(script: Element): ScriptError | undefined {
  const texts = script.childNodes.filter((child): child is TextNode => child.nodeName === "#text");
  if (texts.length === 0) return undefined;
  const lineOffset = (texts[0].sourceCodeLocation?.startLine ?? 1) - 1;
  const compiled = compile(texts.map((text) => text.value).join(""), lineOffset);
  if (!(compiled instanceof SyntaxError)) return undefined;
  const line = /^page:(\d+)/.exec(compiled.stack ?? "")?.[1];
  return { line: line === undefined ? lineOffset + 1 : Number(line), message: compiled.message };
}

function compile(code: string, lineOffset: number): Script | SyntaxError {
  try {
    return new Script(code, { filename: "page", lineOffset });
  } catch (error) {
    if (error instanceof SyntaxError) return error;
    throw error;
  }
}

// The check only advises, so a file it can't read, or code that overflows
// V8's parser, means no warnings rather than a failed command.
export function pageScriptErrors(path: string): ScriptError[] {
  if (previewKind(path) !== "html") return [];
  try {
    const stats = statSync(path, { throwIfNoEntry: false });
    if (!stats?.isFile() || stats.size > MAX_BYTES) return [];
    return scriptSyntaxErrors(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}
