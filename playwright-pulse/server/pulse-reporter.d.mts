import type { RunSnapshot } from "../shared/run.ts";

export const SNAPSHOT_VERSION: 1;
export const RUN_FILE_NAME: string;
export function findRoot(cwd: string): string;
export function pulseDirectory(root: string, home?: string): string;

// The Playwright reporter. Its hooks take Playwright's own objects; they're
// left loose here so the plugin doesn't depend on @playwright/test.
export default class PulseReporter {
  constructor(options?: { cwd?: string; directory?: string });
  file: string;
  snapshot: RunSnapshot;
  printsToStdio(): boolean;
  onBegin(config: any, suite: any): void;
  onTestBegin(test: any, result: any): void;
  onStepBegin(test: any, result: any, step: any): void;
  onStepEnd(test: any, result: any, step: any): void;
  onTestEnd(test: any, result: any): void;
  onError(error: any): void;
  onEnd(result: any): void;
  onExit(): Promise<void>;
}
