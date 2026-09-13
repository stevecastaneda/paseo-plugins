type Page<Entry> = {
  entries: Entry[];
  pageInfo: { hasMore: boolean; nextCursor?: string | null };
};

// Paseo 0.8 starts directory updates with list({ subscribe: {} }) and
// delivers them through a separate subscribe(listener) callback.
export function observeDirectory<Entry, Update>(options: {
  list(options: { subscribe?: {}; page?: { cursor: string; limit: number } }): Promise<Page<Entry>>;
  subscribe(listener: (update: Update) => void): () => void;
  snapshot(entries: Entry[]): void;
  update(update: Update): void;
}) {
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let buffered: Update[] | null = [];
  const unsubscribe = options.subscribe((update) => {
    if (stopped) return;
    if (buffered) buffered.push(update);
    else options.update(update);
  });
  const load = async () => {
    buffered = [];
    try {
      let page = await options.list({ subscribe: {} });
      const entries = [...page.entries];
      while (!stopped && page.pageInfo.hasMore && page.pageInfo.nextCursor) {
        page = await options.list({ page: { cursor: page.pageInfo.nextCursor, limit: 100 } });
        entries.push(...page.entries);
      }
      if (stopped) return;
      // Replay changes received during pagination after the snapshot so late
      // reads cannot resurrect removed targets or overwrite newer updates.
      options.snapshot(entries);
      const pending = buffered;
      buffered = null;
      for (const update of pending ?? []) {
        if (stopped) break;
        options.update(update);
      }
    } catch (error) {
      buffered = null;
      if (!stopped) {
        console.error("Directory observation failed; retrying", error);
        retry = setTimeout(() => void load(), 2_000);
      }
    }
  };
  void load();
  return () => {
    if (stopped) return;
    stopped = true;
    if (retry) clearTimeout(retry);
    buffered = null;
    // The installed API can detach this listener, but cannot cancel the
    // pending list request or release server observation independently.
    unsubscribe();
  };
}
