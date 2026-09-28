// Host-facing values are intentionally loose: fixtures exercise partial SDK payloads.
export function clientHarness(pluginDirectory: string, modules?: Record<string, unknown>): {
  client: any;
  load(path: string): any;
  agents: any;
  workspaces: any;
  registrations: Array<{ removed: boolean; placement: string; button: any; updates: number }>;
  requests: Array<{ name: string; input: any }>;
  watches: Map<string, unknown>;
  /** Workspace panels and Command Center items the contribution registered. */
  panels: Array<any & { removed: boolean }>;
  commandItems: Array<any & { removed: boolean }>;
  /** Calls to client.openPanel. */
  openedPanels: Array<{ id: string; workspaceId?: string; location?: string }>;
  /** URLs passed to openExternalUrl. */
  opened: string[];
  timers: Map<number, { callback(): void; delay: number }>;
  /** RPC results by contract name; a value may be a promise the test settles later. */
  responses: Record<string, unknown>;
  flush(): Promise<void>;
  tick(delay: number): Promise<void>;
};
