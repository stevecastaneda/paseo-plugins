// The last path segment, for either slash style; the client has no node:path.
export function basename(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

// Errors cross a realm boundary in tests and an RPC boundary in the app, so `instanceof Error` is not reliable.
export function errorMessage(error: unknown): string {
  return typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : String(error);
}

// A leading "# ..." line is the title the agent gave a command it suggested. It stays in the
// command, where the shell skips it, and comes off wherever the command is shown or copied.
export function splitTitle(command: string): { title: string | null; script: string } {
  const match = /^#(?!!)[ \t]*(\S[^\n]*)\n(\s*\S[\s\S]*)$/.exec(command);
  return match ? { title: match[1].trim(), script: match[2].trim() } : { title: null, script: command };
}

// Things worth a second look before pressing Run, in plain words. Pattern checks, not a
// shell parser: they catch the common forms, not every disguise.
const AT_COMMAND = String.raw`(?:^|[;&|(\x60]|\bsudo\s+(?:-\S+\s+)*|\bxargs\s+(?:-\S+\s+)*)\s*`;
// PowerShell names are case-insensitive, so its patterns are too.
const RISKS: Array<[RegExp, string]> = [
  [new RegExp(String.raw`(?:^|[;&|(\x60])\s*sudo\b`, "m"), "runs as administrator (sudo)"],
  [/\bStart-Process\b[^\n]*\s-Verb\s+['"]?RunAs\b|(?:^|[;&|(])\s*runas(\.exe)?\s/im, "runs as administrator"],
  [new RegExp(String.raw`${AT_COMMAND}rm\s|\bfind\b[^\n]*\s-delete\b|\bgit\s+clean\s+-\w*f`, "m"), "deletes files"],
  [new RegExp(String.raw`${AT_COMMAND}(?:Remove-Item|del|erase|rd|rmdir)(?:\s|$)`, "im"), "deletes files"],
  [/\bgit\s+reset\s+--hard\b|\bgit\s+checkout\s+(--\s+)?\.(\s|$)|\bgit\s+restore\s+(?!--staged\b)\S|\bgit\s+stash\s+(drop|clear)\b/m, "throws away uncommitted changes"],
  [/\bgit\s+push\b[^\n;&|]*?\s(--force(-with-lease|-if-includes)?\b|-[a-zA-Z]*f[a-zA-Z]*\b|\+\S)/, "force-pushes"],
  [/\b(curl|wget)\b[^\n]*\|\s*(sudo\s+(-\S+\s+)*)?(\S*\/)?((ba|z|da|k|fi)?sh|python3?|node|ruby|perl)\b|\b(ba|z)?sh\b[^\n]*<\(\s*(curl|wget)\b|\b(ba|z)?sh\s+-c\s+["']?\$\(\s*(curl|wget)\b/, "runs a script from the internet"],
  [/\b(irm|iwr|Invoke-RestMethod|Invoke-WebRequest|curl|wget)\b[^\n]*\|\s*(iex|Invoke-Expression)\b|\b(iex|Invoke-Expression)\b[^\n]*\b(irm|iwr|Invoke-RestMethod|Invoke-WebRequest|DownloadString)\b/i, "runs a script from the internet"],
];

export function risksOf(script: string): string[] {
  return [...new Set(RISKS.filter(([pattern]) => pattern.test(script)).map(([, risk]) => risk))];
}

// A command's first line, cut to fit one line of a message or toast.
export function shortCommand(command: string, max = 48): string {
  const [first, ...rest] = splitTitle(command).script.split("\n");
  if (first.length > max) return `${first.slice(0, max - 1).trimEnd()}…`;
  return rest.length > 0 ? `${first} …` : first;
}
