import { useEffect } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import type { TimeSinceSettings } from "../shared/settings";
import { getSettings } from "../shared/settings";

export const settingsQueryKey = (hostId: string) => ["time-since", "settings", hostId];

export function useSettings(hostId: string) {
  const fetchSettings = useRpc(getSettings);
  const query = useQuery({
    queryKey: settingsQueryKey(hostId),
    queryFn: () => fetchSettings({}),
    staleTime: 30_000,
  });
  useEffect(() => { if (query.data) publishSettings(query.data); }, [query.data]);
  return query;
}

const listeners = new Set<(settings: TimeSinceSettings) => void>();
export function publishSettings(settings: TimeSinceSettings) {
  for (const listener of listeners) listener(settings);
}
export function subscribeSettings(listener: (settings: TimeSinceSettings) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
