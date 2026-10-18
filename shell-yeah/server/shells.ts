import { accessSync, constants } from "node:fs";
import { basename, win32 } from "node:path";

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
