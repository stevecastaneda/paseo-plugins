import { spawn } from "node:child_process";
import { closeSync, constants as fileFlags, openSync } from "node:fs";
import { createRequire } from "node:module";
import { constants } from "node:os";
import { StringDecoder } from "node:string_decoder";

export const COLUMNS = 100;
export const ROWS = 40;
const WINDOWS = process.platform === "win32";

// One running command. The registry sees only this, whether it runs in a terminal or on pipes.
export interface Proc {
  // In a terminal it can take typing, and Stop is Ctrl+C, as in the user's own terminal.
  readonly terminal: boolean;
  write(text: string): void;
  interrupt(): void;
  // The command and every process it started, even after the shell has exited.
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

export interface ProcEvents {
  data(text: string): void;
  // Once, after the output is in.
  exit(code: number | null, signal: NodeJS.Signals | null): void;
  error(message: string): void;
}

export interface ProcSpec {
  // The shell and its arguments, command included (see shells.ts).
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  flushMs: number;
}

export interface Spawner {
  readonly terminal: boolean;
  start(spec: ProcSpec, on: ProcEvents): Proc;
}

// The part of node-pty this file uses. Typed here, not imported: Paseo compiles the plugin
// where node-pty may not be installed, and a type import it can't resolve fails the build.
interface PtyModule {
  spawn(file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }): Pty;
}

interface Pty {
  readonly pid: number;
  // The terminal's device on macOS and Linux, like /dev/pts/3. node-pty sets it but leaves it out of its types.
  readonly _pty?: unknown;
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): unknown;
  write(data: string): void;
  // On Windows: ends every process attached to the terminal. Takes no signal there.
  kill(): void;
}

// node-pty has compiled parts, so Paseo can't bundle it into the plugin, and Paseo 0.11 loads a
// plugin's packages from Paseo's own folder, not the plugin's (getpaseo/paseo#6257). Inside
// Paseo, the bundle's `require` is Paseo's, so this loads the node-pty Paseo ships for its own
// terminals. Plugins aren't promised that: if it stops working, commands run on pipes.
// Outside Paseo (tests), `require` doesn't exist and the devDependency loads instead.
export function loadPty(): PtyModule | null {
  try {
    const load = typeof require === "function" ? require : createRequire(import.meta.url);
    return load("node-pty") as PtyModule;
  } catch {
    return null;
  }
}

// A terminal when node-pty loads and can start a process here; otherwise pipes, with no typing.
export function pickSpawner(env: NodeJS.ProcessEnv, mode: "auto" | "off", timeoutMs = 3_000): Promise<Spawner> {
  const pty = mode === "off" ? null : loadPty();
  if (!pty) return Promise.resolve(pipeSpawner);
  const spawner = ptySpawner(pty);
  return new Promise((resolve) => {
    const pick = (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok ? spawner : pipeSpawner);
    };
    const timer = setTimeout(() => pick(false), timeoutMs);
    try {
      spawner.start(
        WINDOWS
          ? { file: env.ComSpec ?? "cmd.exe", args: ["/d", "/c", "exit 0"], cwd: env.SystemRoot ?? "C:\\", env, flushMs: 0 }
          : { file: "/bin/sh", args: ["-c", "exit 0"], cwd: "/", env, flushMs: 0 },
        { data: () => undefined, exit: (code) => pick(code === 0), error: () => pick(false) },
      );
    } catch {
      pick(false);
    }
  });
}

function ptySpawner(pty: PtyModule): Spawner {
  return {
    terminal: true,
    start({ file, args, cwd, env }, on) {
      const term = pty.spawn(file, args, { name: "xterm-256color", cols: COLUMNS, rows: ROWS, cwd, env });
      // On macOS and Linux node-pty starts the shell as a session leader, so its pid is also its process group.
      const group = term.pid;
      const held = WINDOWS ? null : holdOpen(term);
      term.onData(on.data);
      term.onExit(({ exitCode, signal }) => {
        release(held);
        // Close the terminal as a window would. On macOS and Linux, jobs the command left
        // behind get a hangup. On Windows, node-pty keeps the console open until it's killed,
        // and that also ends whatever is still attached to it.
        if (WINDOWS) setImmediate(() => closeQuietly(term));
        else signalGroup(group, "SIGHUP");
        on.exit(signal ? null : exitCode, signal ? signalName(signal) : null);
      });
      return {
        terminal: true,
        write: (text) => term.write(text),
        interrupt: () => term.write("\x03"),
        kill: (signal) => (WINDOWS ? closeQuietly(term) : signalGroup(group, signal)),
      };
    },
  };
}

// On macOS and Linux, `/bin/sh -c 'exec "$0" "$@" 2>&1' <shell> <args>`: one pipe for both
// streams so their interleaving is the kernel's, and the command text is never rewritten.
// detached = its own session and process group, no controlling terminal.
// Windows has no process groups; Stop ends the process tree with taskkill instead.
const pipeSpawner: Spawner = {
  terminal: false,
  start({ file, args, cwd, env, flushMs }, on) {
    const child = WINDOWS
      ? spawn(file, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
      : spawn("/bin/sh", ["-c", 'exec "$0" "$@" 2>&1', file, ...args], { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const group = child.pid ?? null;
    const out = new StringDecoder("utf8");
    const err = new StringDecoder("utf8");
    let flush: NodeJS.Timeout | null = null;
    let done = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (done) return;
      done = true;
      if (flush) clearTimeout(flush);
      on.exit(code, signal);
    };
    child.stdout?.on("data", (chunk: Buffer) => on.data(out.write(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => on.data(err.write(chunk)));
    child.on("error", (error) => {
      if (done) return;
      done = true;
      on.error(error.message);
    });
    child.on("exit", (code, signal) => {
      // A background job can hold the pipe open after the shell exits: flush briefly, then let go.
      flush = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(code, signal);
      }, flushMs);
      flush.unref();
    });
    child.on("close", (code, signal) => {
      if (!done) on.data(out.end() + err.end());
      finish(code, signal);
    });
    return {
      terminal: false,
      write: () => {
        throw new Error("This command can't take typing.");
      },
      interrupt: () => {
        if (group !== null) signalTree(group, "SIGINT");
      },
      kill: (signal) => {
        if (group !== null) signalTree(group, signal);
      },
    };
  },
};

// On Linux, when the command's shell exits and nothing else has its terminal open, output not
// yet read is thrown away, and a command that prints a lot just before it ends loses its last
// lines. Holding the terminal open keeps that output readable until node-pty reports the exit,
// which then comes about 200 ms later.
function holdOpen(term: Pty): number | null {
  if (typeof term._pty !== "string") return null;
  try {
    return openSync(term._pty, fileFlags.O_RDWR | fileFlags.O_NOCTTY);
  } catch {
    return null;
  }
}

function release(fd: number | null): void {
  if (fd === null) return;
  try {
    closeSync(fd);
  } catch {
    // Already closed.
  }
}

function closeQuietly(term: Pty): void {
  try {
    term.kill();
  } catch {
    // Already closed.
  }
}

function signalName(signal: number): NodeJS.Signals | null {
  const found = Object.entries(constants.signals).find(([, number]) => number === signal);
  return found ? (found[0] as NodeJS.Signals) : null;
}

function signalTree(pid: number, signal: NodeJS.Signals): void {
  if (!WINDOWS) return signalGroup(pid, signal);
  spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => undefined);
}

// Signals the whole group, even after its leader (the shell) has exited, so background jobs
// it left behind are reached too. An empty group is ESRCH, which is fine.
export function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // The group is already gone.
  }
}
