import { readFileSync, statSync } from "node:fs";
import { Script } from "node:vm";
import { previewKind } from "../shared/attachments.ts";

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const CLASSIC_TYPES = new Set(["", "text/javascript", "application/javascript"]);
const MAX_BYTES = 5 * 1024 * 1024;

export interface ScriptError {
  line: number;
  message: string;
}

// One syntax error makes the browser drop the whole script, so the page opens
// blank in Paseo's preview. Compiling a vm.Script parses the code without
// running it. Module scripts and scripts loaded by src aren't checked.
export function scriptSyntaxError(html: string): ScriptError | undefined {
  for (const match of html.matchAll(SCRIPT)) {
    const [, attributes, code] = match;
    if (/(?:^|\s)src\s*=/i.test(attributes)) continue;
    const type = /(?:^|\s)type\s*=\s*["']?([^"'\s>]*)/i.exec(attributes)?.[1].toLowerCase() ?? "";
    if (!CLASSIC_TYPES.has(type)) continue;
    const codeStart = match.index + "<script".length + attributes.length + 1;
    const lineOffset = html.slice(0, codeStart).split("\n").length - 1;
    const compiled = compile(code, lineOffset);
    if (compiled instanceof SyntaxError) {
      const line = /^page:(\d+)/.exec(compiled.stack ?? "")?.[1];
      return { line: Number(line ?? lineOffset + 1), message: compiled.message };
    }
  }
  return undefined;
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
