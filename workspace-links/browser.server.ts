import { execFile, type ExecFileOptions } from "node:child_process";
import { win32 } from "node:path";
import { promisify } from "node:util";
import { webUrlSchema } from "./links.shared.ts";

const execute = promisify(execFile);

export function browserCommand(url: string, platform: NodeJS.Platform = process.platform) {
  webUrlSchema.parse(url);
  if (platform === "darwin") return { file: "/usr/bin/open", args: [url] };
  if (platform === "linux") return { file: "xdg-open", args: [url] };
  if (platform === "win32") {
    return {
      file: win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      // The URL is data in the environment, never interpolated into PowerShell code.
      args: ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference = 'Stop'; Start-Process -FilePath $env:PASEO_WORKSPACE_LINK_URL"],
    };
  }
  throw new Error("Opening links is supported on macOS, Windows, and Linux hosts.");
}

export async function launchUrl(
  url: string,
  run: (file: string, args: string[], options: ExecFileOptions) => Promise<unknown> = execute,
) {
  const { file, args } = browserCommand(url);
  try {
    await run(file, args, {
      shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024,
      env: { ...process.env, PASEO_WORKSPACE_LINK_URL: url },
    });
  } catch {
    throw new Error("Could not open the host's default browser. Check its default-browser setting and desktop session (Linux also needs xdg-open).");
  }
}
