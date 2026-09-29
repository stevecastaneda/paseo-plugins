import type { OwnedSubscription, SubscriptionObserver } from "@getpaseo/client";

type Page = {
  entries: unknown[];
  pageInfo: { hasMore: boolean; nextCursor?: string | null };
};
type Message = Parameters<SubscriptionObserver<unknown>["update"]>[0];

// Paseo 0.9 returns an owned subscription from list({ subscribe: {} }). It
// delivers the first page as a snapshot, again after every reconnect, then the
// directory updates. Releasing it ends the daemon observation.
export function observeDirectory<Result extends Page & { subscription?: OwnedSubscription<Result> }, Update>(options: {
  list(options: { subscribe?: {}; page?: { cursor: string; limit: number } }): Promise<Result>;
  select(message: Message): Update | undefined;
  snapshot(entries: Result["entries"]): void;
  update(update: Update): void;
}) {
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let subscription: OwnedSubscription<Result> | undefined;
  let generation = 0;
  let buffered: Update[] | null = null;
  const release = () => {
    void subscription?.release().catch(() => undefined);
    subscription = undefined;
  };
  const restart = (error: unknown) => {
    generation++;
    buffered = null;
    release();
    if (stopped) return;
    console.error("Directory observation failed; retrying", error);
    retry = setTimeout(() => void start(), 2_000);
  };
  const load = async (first: Result) => {
    const run = ++generation;
    buffered = [];
    const entries = [...first.entries];
    let page: Page = first;
    try {
      while (page.pageInfo.hasMore && page.pageInfo.nextCursor) {
        page = await options.list({ page: { cursor: page.pageInfo.nextCursor, limit: 100 } });
        if (stopped || run !== generation) return;
        entries.push(...page.entries);
      }
    } catch (error) {
      if (run === generation) restart(error);
      return;
    }
    if (stopped || run !== generation) return;
    // Replay changes received during pagination after the snapshot so late
    // reads cannot resurrect removed targets or overwrite newer updates.
    const pending = buffered ?? [];
    buffered = null;
    options.snapshot(entries);
    for (const update of pending) {
      if (stopped || run !== generation) break;
      options.update(update);
    }
  };
  const start = async () => {
    try {
      const result = await options.list({ subscribe: {} });
      if (!result.subscription) throw new Error("Paseo did not return a directory subscription");
      subscription = result.subscription;
      if (stopped) return release();
      subscription.subscribe({
        snapshot: (first) => void load(first),
        update: (message) => {
          const update = options.select(message);
          if (stopped || update === undefined) return;
          if (buffered) buffered.push(update);
          else options.update(update);
        },
        error: restart,
      });
    } catch (error) {
      restart(error);
    }
  };
  void start();
  return () => {
    if (stopped) return;
    stopped = true;
    if (retry) clearTimeout(retry);
    generation++;
    buffered = null;
    release();
  };
}
