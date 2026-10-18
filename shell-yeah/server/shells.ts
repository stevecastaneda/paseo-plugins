import { accessSync, constants } from "node:fs";
import { basename, posix, win32 } from "node:path";

// The shell that runs a command, with the arguments that hand it the command.
// macOS and Linux: the user's login shell, non-interactive, so startup files like .zshrc don't load.
// Windows: PowerShell, the shell Windows Terminal opens, without the user's profile for the same reason.
export function shellCommand(env: NodeJS.ProcessEnv, command: string, platform: NodeJS.Platform = process.platform): { file: string; args: string[] } {
  if (platform === "win32") return { file: pickPowerShell(env), args: ["-NoLogo", "-NoProfile", "-EncodedCommand", encodePowerShell(command)] };
  return { file: pickShell(env.SHELL), args: ["-c", command] };
}

const SHELLS = new Set(["zsh", "bash", "sh", "dash", "ksh", "fish"]);

export function pickShell(preferred: string | undefined): string {
  const candidates = [preferred && SHELLS.has(basename(preferred)) ? preferred : null, "/bin/bash", "/bin/sh"];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return "/bin/sh";
}

// PowerShell 7 when it's on the PATH, else the Windows PowerShell every Windows ships.
function pickPowerShell(env: NodeJS.ProcessEnv): string {
  for (const dir of (env.PATH ?? env.Path ?? "").split(";").filter(Boolean)) {
    const pwsh = win32.join(dir, "pwsh.exe");
    try {
      accessSync(pwsh);
      return pwsh;
    } catch {
      continue;
    }
  }
  return win32.join(env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

// -EncodedCommand takes the script as base64 UTF-16, so no quote in it can be misread on the way.
// Before it: UTF-8 output, which Windows PowerShell doesn't default to. After it: the exit code
// of the last program that failed, as bash would give, since PowerShell's own is only 0 or 1.
export function encodePowerShell(command: string): string {
  const script = [
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$OutputEncoding = [Console]::OutputEncoding",
    command,
    "if (-not $?) { if ($LASTEXITCODE) { exit $LASTEXITCODE }; exit 1 }",
  ].join("\n");
  return Buffer.from(script, "utf16le").toString("base64");
}

// Words a shell runs without a program on the PATH.
const BUILTINS = new Set(["cd", "export", "source", ".", "echo", "printf", "set", "unset", "alias", "eval", "exec", "pushd", "popd", "ulimit", "umask", "for", "if", "while"]);
const POWERSHELL_WORDS = new Set(["cd", "ls", "dir", "cat", "echo", "rm", "cp", "mv", "del", "copy", "move", "mkdir", "type", "cls", "&"]);

// Whether a word starts a command here: a shell builtin, a program on the PATH, or a path to
// a program, read from the folder the command runs in. On Windows also a cmdlet (Verb-Noun)
// and PATHEXT programs. Remembers each word, so a long reply costs one lookup per word.
export function commandFinder(env: NodeJS.ProcessEnv, cwd: string, platform: NodeJS.Platform = process.platform): (word: string) => boolean {
  const windows = platform === "win32";
  const path = windows ? win32 : posix;
  const dirs = (env.PATH ?? env.Path ?? "").split(windows ? ";" : ":").filter(Boolean);
  const exts = windows ? ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)] : [""];
  const runnable = (file: string) => {
    for (const ext of exts) {
      try {
        accessSync(file + ext, windows ? constants.F_OK : constants.X_OK);
        return true;
      } catch {
        continue;
      }
    }
    return false;
  };
  const seen = new Map<string, boolean>();
  return (word) => {
    let found = seen.get(word);
    if (found !== undefined) return found;
    if (windows) found = POWERSHELL_WORDS.has(word.toLowerCase()) || /^[A-Z][a-z]+-[A-Z][A-Za-z]+$/.test(word);
    else found = BUILTINS.has(word);
    if (!found && /[\\/]/.test(word)) found = runnable(path.resolve(cwd, word));
    else if (!found) found = dirs.some((dir) => runnable(path.join(dir, word)));
    seen.set(word, found);
    return found;
  };
}
