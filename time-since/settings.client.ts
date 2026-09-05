import { useRpc } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import { getSettings } from "./settings.shared";

export const settingsQueryKey = (hostId: string) => ["time-since", "settings", hostId];

export function useSettings(hostId: string) {
  const fetchSettings = useRpc(getSettings);
  return useQuery({
    queryKey: settingsQueryKey(hostId),
    queryFn: () => fetchSettings({}),
    staleTime: 30_000,
  });
}
