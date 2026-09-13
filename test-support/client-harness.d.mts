// Host-facing values are intentionally loose: fixtures exercise partial SDK payloads.
export function clientHarness(pluginDirectory: string): {
  client: any;
  load(path: string): any;
  agents: any;
  workspaces: any;
  registrations: Array<{ removed: boolean; placement: string; button: any; updates: number }>;
  requests: Array<{ name: string; input: any }>;
  watches: Map<string, unknown>;
  timers: Map<number, { callback(): void; delay: number }>;
  flush(): Promise<void>;
  tick(delay: number): Promise<void>;
};
