// The run snapshot the reporter writes to runs/<id>.json and the panel reads.
// server/pulse-reporter.mjs builds it; keep the two in step.

export type RunStatus = "starting" | "running" | "passed" | "failed" | "timedout" | "interrupted";
export type TestStatus = "running" | "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
// Playwright's verdict once retries are counted.
export type TestOutcome = "expected" | "unexpected" | "flaky" | "skipped";

export type Attachment = { name: string; contentType: string; path: string };

export type LiveStep = {
  title: string;
  subtitle?: string;
  category: string;
  startedAt: string;
  // The test.step or hook around it, e.g. "beforeEach hook".
  context?: string;
};

export type DoneStep = { title: string; subtitle?: string; duration: number; failed?: boolean };

export type PulseTest = {
  id: string;
  title: string;
  // The describe blocks around the test, outermost first.
  titlePath: string[];
  // Relative to the worktree root.
  file: string;
  line: number;
  project: string;
  status: TestStatus;
  retry: number;
  startedAt?: string;
  duration?: number;
  // Milliseconds; 0 means none.
  timeout: number;
  outcome?: TestOutcome;
  step?: LiveStep;
  recentSteps?: DoneStep[];
  failedStep?: string;
  error?: { message: string; snippet?: string; location?: { file: string; line: number } };
  attachments: Attachment[];
};

export type RunSnapshot = {
  v: 1;
  id: string;
  pid: number;
  root: string;
  // The command's arguments after `playwright test`.
  args: string[];
  status: RunStatus;
  startedAt: string;
  testsStartedAt?: string;
  endedAt?: string;
  updatedAt: string;
  total: number;
  projects: string[];
  workers: number;
  // In the order they started.
  tests: PulseTest[];
  // Errors outside any test, like a web server that never came up.
  errors: string[];
};
