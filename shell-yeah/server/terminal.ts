import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

// Runs a command in a real terminal, so it behaves as it does in the user's own: prompts
// appear and take typing, and tools that check for a terminal (npm's 2FA) don't bail out.
// Node has no terminal API, so this borrows the system's `script` tool, which every macOS,
// Linux and BSD ships. Where it is missing or misbehaves, the probe fails and commands run
// without a terminal, as before.
//
// Two quirks shape the launch:
// - macOS `script` refuses a socket as its stdin, and Node's stdin pipes are sockets. A bash
//   (or zsh) process substitution puts a real pipe in between: `script < <(cat)`.
// - Linux `script` stops passing output along once the command exits, and lingers until its
//   stdin closes. So the wrapper prints an end marker (an OSC escape the screen drops, carrying
//   the exit code) and then waits. The registry ends the run on the marker, not on `script`.
// - When `script` dies, Linux hangs up only the terminal's first process, not the command or
//   its background jobs. So the wrapper also reports its process group at the start, and the
//   registry signals that group itself to stop the command or to close the terminal.
export interface Terminal {
  // bash or zsh, for the process substitution.
  shell: string;
  script: string;
  flavor: "bsd" | "linux";
}

export const COLUMNS = 100;
export const ROWS = 40;

// Runs inside the terminal as /bin/sh. Survives Ctrl+C (`trap :`, which the command doesn't
// inherit) so it can still report how the command ended. Puts $SHELL back for the command.
// `stty sane` undoes a raw mode the command left behind, so the final read sees end of input.
const WRAPPER = [
  "trap : INT",
  "printf '\\033]%s;group=%s\\007' \"$SHELL_YEAH_MARK\" \"$$\"",
  'stty cols "$SHELL_YEAH_COLS" rows "$SHELL_YEAH_ROWS" 2>/dev/null',
  "s=$SHELL_YEAH_SHELL c=$SHELL_YEAH_COMMAND m=$SHELL_YEAH_MARK",
  'if [ -n "${SHELL_YEAH_HOME_SHELL+set}" ]; then SHELL=$SHELL_YEAH_HOME_SHELL; export SHELL; else unset SHELL; fi',
  "unset SHELL_YEAH_SHELL SHELL_YEAH_COMMAND SHELL_YEAH_MARK SHELL_YEAH_HOME_SHELL SHELL_YEAH_COLS SHELL_YEAH_ROWS",
  '"$s" -c "$c"',
  "code=$?",
  "stty sane 2>/dev/null",
  "printf '\\033]%s;%s\\007' \"$m\" \"$code\"",
  "read -r _",
].join("\n");

export function findTerminal(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): Terminal | null {
  const flavor = platform === "linux" ? "linux" : platform === "darwin" || platform.endsWith("bsd") ? "bsd" : null;
  if (!flavor) return null;
  const shell = firstExecutable(["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash", "/bin/zsh", "/usr/bin/zsh"]);
  const script = firstExecutable([...(env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, "script")), "/usr/bin/script", "/bin/script"]);
  return shell && script ? { shell, script, flavor } : null;
}

// What the wrapper prints at the start (its process group) and at the end (the exit code).
// `mark` is unguessable per run, so output can't fake either.
export function markers(mark: string): { group: RegExp; end: RegExp } {
  return { group: new RegExp(`\\x1b\\]${mark};group=(\\d+)\\x07`), end: new RegExp(`\\x1b\\]${mark};(\\d+)\\x07`) };
}

// `env` is the command's environment (commandEnv). `shell` runs the command, as without a terminal.
export function spawnInTerminal(terminal: Terminal, input: { command: string; cwd: string; env: NodeJS.ProcessEnv; shell: string; mark: string }): ChildProcess {
  const { env } = input;
  const scriptArgs = terminal.flavor === "bsd" ? ["-q", "/dev/null", "/bin/sh", "-c", WRAPPER] : ["-q", "-c", WRAPPER, "/dev/null"];
  const launch = `exec "$0" "$@" < <(exec cat)`;
  const vars: NodeJS.ProcessEnv = {
    ...env,
    // Linux `script` runs its -c string with $SHELL; the wrapper puts the user's back.
    SHELL: "/bin/sh",
    SHELL_YEAH_SHELL: input.shell,
    SHELL_YEAH_COMMAND: input.command,
    SHELL_YEAH_MARK: input.mark,
    SHELL_YEAH_COLS: String(COLUMNS),
    SHELL_YEAH_ROWS: String(ROWS),
    ...(env.SHELL !== undefined ? { SHELL_YEAH_HOME_SHELL: env.SHELL } : {}),
  };
  return spawn(terminal.shell, ["-c", launch, terminal.script, ...scriptArgs], {
    cwd: input.cwd,
    env: vars,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// One real run of `exit 0` through the terminal. True only if the end marker comes back.
export function probeTerminal(terminal: Terminal, env: NodeJS.ProcessEnv, timeoutMs = 3_000): Promise<boolean> {
  return new Promise((resolve) => {
    const mark = "shell-yeah-probe";
    let child: ChildProcess;
    try {
      child = spawnInTerminal(terminal, { command: "exit 0", cwd: "/", env, shell: "/bin/sh", mark });
    } catch {
      resolve(false);
      return;
    }
    let seen = "";
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdin?.destroy();
      // `exit 0` left nothing behind; the wrapper and `script` go with this.
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.on("error", () => finish(false));
    child.stdout?.on("data", (chunk: Buffer) => {
      seen = (seen + chunk.toString("utf8")).slice(-512);
      if (markers(mark).end.test(seen)) finish(true);
    });
  });
}

function firstExecutable(paths: string[]): string | null {
  for (const path of paths) {
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      continue;
    }
  }
  return null;
}
