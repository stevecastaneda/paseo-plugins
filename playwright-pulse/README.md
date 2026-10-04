# playwright-pulse

A live sidebar dashboard in Paseo for the Playwright test run in a worktree. You see the run as it happens: the test running now and its current step, how far through the run it is, and each failure with its error, screenshot, video and trace.

## What it shows

- **Header:** whether the run is starting up, running, passed, failed or interrupted, with a clock, the command that started it, and a progress bar split into passed, failed and skipped.
- **Stop:** ends a live run the way Ctrl+C in its terminal would: Playwright stops the running test, runs teardown and shuts its web servers. The first press asks to confirm; if the run hasn't ended 8 seconds later, the button offers to force it.
- **Starting up:** while Playwright boots web servers and runs global setup, before the first test.
- **Running now:** the test's title and file, its live step (`Click  getByTestId('save')`, inside its `test.step` or hook), the last few steps, and how much of its timeout it has used.
- **Failures:** pinned above the rest, with the error, the failing step, the code around it, and buttons to preview the screenshot, open the video, open the trace in Playwright's trace viewer, or copy the error.
- **Tests:** every finished test; passed ones fold into one row. Flaky tests (passed on a retry) are marked.

Open it from Explorer, or with **Open Playwright Pulse** in the Command Center.

## Setup

1. Install the plugin:

   ```bash
   paseo plugin add npm:@stevecastaneda/paseo-playwright-pulse
   ```

2. Open the panel and press **Set up**. That writes the reporter to `~/.local/share/playwright-pulse/reporter.mjs`. The plugin keeps that file up to date after that, and never replaces a file it didn't write.

3. Add the reporter to your `playwright.config.ts`, only where it's installed and never in CI:

   ```ts
   import { existsSync } from "node:fs";
   import { homedir } from "node:os";
   import { join } from "node:path";
   import { defineConfig, type ReporterDescription } from "@playwright/test";

   const pulseReporter = join(homedir(), ".local/share/playwright-pulse/reporter.mjs");
   const pulse: ReporterDescription[] = !process.env.CI && existsSync(pulseReporter) ? [[pulseReporter]] : [];

   export default defineConfig({
     reporter: [["list"], ...pulse],
   });
   ```

4. Run tests without a `--reporter` flag. That flag replaces every reporter in the config, Pulse included. To add one for a single run, use `--add-reporter` instead.

## How it works

The reporter writes a snapshot of the run to `~/.local/state/playwright-pulse/<worktree>-<hash>/run.json`, outside the repo, so git never sees it. The worktree is the nearest folder with `.git` above where Playwright runs. Only the latest run is kept.

The reporter is plain JavaScript with no dependencies. It never fails a run: a write that fails is skipped. It writes at most four times a second, and right away when a test or the run ends. A run whose process dies without ending shows as interrupted.

Screenshots preview inside Paseo. Videos open in their default app, and traces in the worktree's own `node_modules/.bin/playwright show-trace`. Only files that the latest run lists, and that sit inside the worktree, can be opened.

Set `PLAYWRIGHT_PULSE=0` to turn the reporter off for one run.

## Requirements

Paseo 0.10 or later and Node.js 22.18 or later on the daemon host. Built and tested with Playwright 1.63.
