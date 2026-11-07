import { readFileSync, statSync } from "node:fs";
import { Script } from "node:vm";
import { html as htmlNames, parse, type DefaultTreeAdapterTypes } from "parse5";
import { previewKind } from "../shared/attachments.ts";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type TextNode = DefaultTreeAdapterTypes.TextNode;

const MAX_BYTES = 5 * 1024 * 1024;

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

// One syntax error makes the browser drop the whole script, so the page opens
// blank in Paseo's preview. parse5 finds the scripts the way a browser's parser
// does, and compiling a vm.Script parses the code without running it. Module
// scripts aren't checked, because node:vm can't parse them without a flag.
export function scriptSyntaxError(html: string): ScriptError | undefined {
  const pending: Node[] = [parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: true })];
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (!("childNodes" in node)) continue;
    const error = isClassicScript(node) ? compileError(node) : undefined;
    if (error) return error;
    for (let index = node.childNodes.length - 1; index >= 0; index--) pending.push(node.childNodes[index]);
  }
  return undefined;
}

function isClassicScript(node: Node): node is Element {
  if (!("tagName" in node) || node.tagName !== "script") return false;
  if (node.namespaceURI !== htmlNames.NS.HTML && node.namespaceURI !== htmlNames.NS.SVG) return false;
  // An unclosed script runs to the end of the page, and the browser never runs it.
  if (!node.sourceCodeLocation?.endTag) return false;
  const attribute = (name: string) => node.attrs.find((candidate) => candidate.name === name)?.value;
  if (attribute("src") !== undefined) return false;
  const type = attribute("type");
  const language = attribute("language");
  if (type === undefined && !language) return true;
  const essence = (type ?? `text/${language}`).trim().toLowerCase();
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

// Only a regular file is read, so a pipe named page.html can't hang the command.
export function pageScriptError(path: string): ScriptError | undefined {
  if (previewKind(path) !== "html") return undefined;
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats?.isFile() || stats.size > MAX_BYTES) return undefined;
  return scriptSyntaxError(readFileSync(path, "utf8"));
}
