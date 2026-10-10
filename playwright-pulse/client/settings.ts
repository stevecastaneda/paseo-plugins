// The options, read through React Query and by the run watcher's poll (see
// pill.tsx). Both hand what they read to publishSettings, which keeps the
// newest and passes it on, so an older read never undoes a newer one.
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { getSettings, type PulseSettings } from "../shared/settings";

export const settingsQueryKey = (hostId: string) => ["playwright-pulse", "settings", hostId];

export function useSettings(hostId: string) {
  const fetchSettings = useRpc(getSettings);
  const query = useQuery({ queryKey: settingsQueryKey(hostId), queryFn: () => fetchSettings({}), staleTime: 30_000 });
  useEffect(() => {
    if (query.data) publishSettings(query.data, query.dataUpdatedAt);
  }, [query.data, query.dataUpdatedAt]);
  const newest = useSyncExternalStore(subscribeSettings, () => latest);
  // The poll may have read the options after this query did.
  const data = newest && (!query.data || newest.at > query.dataUpdatedAt) ? newest.settings : query.data;
  return { ...query, data };
}

let latest: { settings: PulseSettings; at: number } | null = null;
const listeners = new Set<(settings: PulseSettings) => void>();

// `at` is when the options were read: for a request, when it was sent.
export function publishSettings(settings: PulseSettings, at = Date.now()) {
  if (latest && at < latest.at) return;
  latest = { settings, at };
  for (const listener of listeners) listener(settings);
}

export function subscribeSettings(listener: (settings: PulseSettings) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
