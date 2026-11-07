import { readFileSync, statSync } from "node:fs";
import { Script } from "node:vm";
import { previewKind } from "../shared/attachments.ts";

// The browser ends a script at the first closing tag, skips a script inside an
// HTML comment, and runs an unclosed script or comment to the end of the page.
// Searching from each opening tag for its closing tag, and stopping at the
// first unclosed one, keeps the scan linear.
const OPEN = /<!--|<script\b([^>]{0,256})>/gi;
const CLOSE = /<\/script\s*>/gi;
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
  OPEN.lastIndex = 0;
  let counted = 0;
  let lineOffset = 0;
  for (let open = OPEN.exec(html); open; open = OPEN.exec(html)) {
    if (open[0] === "<!--") {
      const end = html.indexOf("-->", OPEN.lastIndex);
      if (end === -1) break;
      OPEN.lastIndex = end + 3;
      continue;
    }
    CLOSE.lastIndex = OPEN.lastIndex;
    const close = CLOSE.exec(html);
    if (!close) break;
    const attributes = open[1];
    const code = html.slice(OPEN.lastIndex, close.index);
    OPEN.lastIndex = CLOSE.lastIndex;
    if (/(?:^|\s)src\s*=/i.test(attributes)) continue;
    const type = /(?:^|\s)type\s*=\s*["']?([^"'\s>]*)/i.exec(attributes)?.[1].toLowerCase() ?? "";
    if (!CLASSIC_TYPES.has(type)) continue;
    for (; counted < open.index + open[0].length; counted++) if (html.charCodeAt(counted) === 10) lineOffset++;
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
