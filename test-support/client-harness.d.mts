// Host-facing values are intentionally loose: fixtures exercise partial SDK payloads.
export function clientHarness(pluginDirectory: string, modules?: Record<string, unknown>): {
  client: any;
  load(path: string): any;
  agents: any;
  workspaces: any;
  registrations: Array<{ removed: boolean; placement: string; button: any; updates: number }>;
  requests: Array<{ name: string; input: any }>;
  watches: Map<string, unknown>;
  /** URLs passed to openExternalUrl. */
  opened: string[];
  timers: Map<number, { callback(): void; delay: number }>;
  /** RPC results by contract name; a value may be a promise the test settles later. */
  responses: Record<string, unknown>;
  flush(): Promise<void>;
  tick(delay: number): Promise<void>;
};
