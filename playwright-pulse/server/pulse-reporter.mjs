// Written by the playwright-pulse Paseo plugin.
//
// A Playwright reporter that keeps a snapshot of the current run in a file
// outside the repo, one folder per worktree, for the Playwright Pulse panel.
// Plain JavaScript with no dependencies: the plugin copies this file to a
// fixed path that a project's playwright.config.ts names.
//
// It must never fail or slow a test run, so every write is guarded and
// throttled.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

export const SNAPSHOT_VERSION = 1;
export const RUN_FILE_NAME = "run.json";

const FLUSH_MS = 250;
const MAX_ERROR_CHARS = 4000;
const RECENT_STEPS = 5;
// Steps that say nothing about what the test is doing: attachments, and the
// calls a fixture makes while it sets up or tears down ("Create context").
// The fixture itself still shows, so a slow login fixture doesn't look idle.
function quiet(step) {
  if (step.category === "test.attach") return true;
  for (let parent = step.parent; parent; parent = parent.parent) {
    if (parent.category === "fixture") return true;
  }
  return false;
}
// Steps the "just done" trail leaves out: they wrap other steps.
const WRAPPERS = new Set(["hook", "test.step", "fixture"]);

// The worktree root is the nearest directory with a `.git` entry (a folder in
// a checkout, a file in a linked worktree). Outside git, use the directory.
export function findRoot(cwd) {
  let directory = resolve(cwd);
  while (true) {
    if (existsSync(join(directory, ".git"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return resolve(cwd);
    directory = parent;
  }
}

// One folder per worktree on this computer, named so a person can tell which
// worktree it belongs to.
export function pulseDirectory(root, home = homedir()) {
  let real = root;
  try {
    real = realpathSync(root);
  } catch {}
  const hash = createHash("sha1").update(real).digest("hex").slice(0, 8);
  return join(home, ".local", "state", "playwright-pulse", `${basename(real)}-${hash}`);
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

function clean(text, limit = MAX_ERROR_CHARS) {
  if (typeof text !== "string") return undefined;
  const plain = text.replace(ANSI, "");
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain;
}

function iso(date) {
  return (date instanceof Date ? date : new Date()).toISOString();
}

function stepView(step) {
  const view = { title: clean(step.title, 200) ?? "", category: step.category, startedAt: iso(step.startTime) };
  if (step.subtitle) view.subtitle = clean(step.subtitle, 200);
  return view;
}

// The nearest enclosing test.step or hook, so "Click" reads in its context.
function stepContext(step) {
  for (let parent = step.parent; parent; parent = parent.parent) {
    if (parent.category === "test.step" || parent.category === "hook") return clean(parent.title, 200);
  }
  return undefined;
}

export default class PulseReporter {
  constructor(options = {}) {
    this.disabled = process.argv.includes("--list") || process.env.PLAYWRIGHT_PULSE === "0";
    this.root = findRoot(options.cwd ?? process.cwd());
    this.file = join(options.directory ?? pulseDirectory(this.root), RUN_FILE_NAME);
    this.timer = null;
    this.running = new Map(); // test id -> step stack (begun, not ended)
    this.snapshot = {
      v: SNAPSHOT_VERSION,
      id: `${Date.now().toString(36)}-${process.pid}`,
      pid: process.pid,
      root: this.root,
      args: process.argv.slice(2).filter((arg) => arg !== "test"),
      status: "starting",
      startedAt: iso(),
      updatedAt: iso(),
      total: 0,
      projects: [],
      workers: 1,
      tests: [],
      errors: [],
    };
    // Playwright builds reporters before it boots web servers and runs global
    // setup, so this first write is what shows "Starting up" during that wait.
    this.flush();
  }

  printsToStdio() {
    return false;
  }

  onBegin(config, suite) {
    const tests = suite.allTests();
    this.snapshot.status = "running";
    this.snapshot.testsStartedAt = iso();
    this.snapshot.total = tests.length;
    this.snapshot.workers = config.workers;
    this.snapshot.projects = [...new Set(tests.map((test) => test.parent?.project()?.name).filter(Boolean))];
    this.flush();
  }

  onTestBegin(test, result) {
    const entry = this.entry(test);
    entry.status = "running";
    entry.retry = result.retry;
    entry.startedAt = iso(result.startTime);
    delete entry.duration;
    delete entry.error;
    delete entry.failedStep;
    entry.attachments = [];
    entry.recentSteps = [];
    this.running.set(test.id, []);
    this.schedule(true);
  }

  onStepBegin(test, _result, step) {
    if (quiet(step)) return;
    const stack = this.running.get(test.id);
    if (!stack) return;
    stack.push(step);
    this.setCurrent(test, stack);
    this.schedule();
  }

  onStepEnd(test, _result, step) {
    if (quiet(step)) return;
    const stack = this.running.get(test.id);
    if (!stack) return;
    const index = stack.lastIndexOf(step);
    if (index >= 0) stack.splice(index, 1);
    const entry = this.entry(test);
    if (!WRAPPERS.has(step.category)) {
      const done = { title: clean(step.title, 200) ?? "", duration: step.duration };
      if (step.subtitle) done.subtitle = clean(step.subtitle, 200);
      if (step.error) done.failed = true;
      entry.recentSteps = [...(entry.recentSteps ?? []), done].slice(-RECENT_STEPS);
    }
    if (step.error && !entry.failedStep) {
      entry.failedStep = clean(step.subtitle ? `${step.title} · ${step.subtitle}` : step.title, 300);
    }
    this.setCurrent(test, stack);
    this.schedule();
  }

  onTestEnd(test, result) {
    const entry = this.entry(test);
    this.running.delete(test.id);
    delete entry.step;
    entry.status = result.status;
    entry.retry = result.retry;
    entry.duration = result.duration;
    entry.outcome = test.outcome();
    const error = result.errors?.[0] ?? result.error;
    if (error) {
      entry.error = { message: clean(error.message ?? error.value ?? "") ?? "" };
      if (error.snippet) entry.error.snippet = clean(error.snippet, 2000);
      if (error.location) entry.error.location = { file: this.relative(error.location.file), line: error.location.line };
    }
    entry.attachments = (result.attachments ?? [])
      .filter((attachment) => attachment.path)
      .map((attachment) => ({ name: attachment.name, contentType: attachment.contentType, path: attachment.path }));
    this.schedule(true);
  }

  onError(error) {
    this.snapshot.errors.push(clean(error.message ?? error.value ?? String(error)) ?? "");
    this.schedule(true);
  }

  onEnd(result) {
    this.snapshot.status = result.status;
    this.snapshot.endedAt = iso();
    for (const entry of this.snapshot.tests) {
      if (entry.status === "running") {
        entry.status = "interrupted";
        delete entry.step;
      }
    }
    this.flush();
  }

  async onExit() {
    if (this.timer) this.flush();
  }

  entry(test) {
    let entry = this.snapshot.tests.find((candidate) => candidate.id === test.id);
    if (!entry) {
      entry = {
        id: test.id,
        title: test.title,
        titlePath: test.titlePath().slice(3, -1),
        file: this.relative(test.location.file),
        line: test.location.line,
        project: test.parent?.project()?.name ?? "",
        status: "running",
        retry: 0,
        timeout: test.timeout,
        attachments: [],
      };
      this.snapshot.tests.push(entry);
    }
    return entry;
  }

  // The innermost step still running, with the test.step or hook around it.
  setCurrent(test, stack) {
    const entry = this.entry(test);
    const step = stack.at(-1);
    if (!step) {
      delete entry.step;
      return;
    }
    entry.step = stepView(step);
    const context = stepContext(step);
    if (context) entry.step.context = context;
  }

  relative(file) {
    return file ? relative(this.root, file) : "";
  }

  // Coalesces bursts of steps into one write; a test or run ending writes now.
  schedule(now = false) {
    if (now) {
      this.flush();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), FLUSH_MS);
    this.timer.unref?.();
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.disabled) return;
    try {
      this.snapshot.updatedAt = iso();
      mkdirSync(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(this.snapshot));
      renameSync(temporary, this.file);
    } catch {
      // The dashboard is a nicety; a failed write must never fail the run.
    }
  }
}
