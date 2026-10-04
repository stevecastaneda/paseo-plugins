// Its own file: stopping the plugin is for good, within one process.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startReporter, stopReporter } from "./reporter-install.ts";

const SOURCE = "// Written by the playwright-pulse Paseo plugin.\nexport default class {}\n";

test("stopping while the plugin is still starting leaves no reporter behind", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "pulse-reporter-")), "reporter.mjs");
  let release = () => {};
  // Finding the plugin's own files takes a moment (it asks the paseo CLI).
  const slowSource = () => new Promise<string>((resolve) => { release = () => resolve(SOURCE); });
  const starting = startReporter(path, slowSource);
  const stopping = stopReporter(path);
  release();
  await Promise.all([starting, stopping]);
  assert.equal(existsSync(path), false);
  // And nothing writes it once stopped.
  await startReporter(path, async () => SOURCE);
  assert.equal(existsSync(path), false);
});
