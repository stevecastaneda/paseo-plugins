import { useRpc } from "@getpaseo/plugin/client";
import type { RpcOutput } from "@getpaseo/plugin";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type DashboardResult, getDashboard } from "../shared/rpc";

type FetchDashboard = (input: { workspaceId: string; workspaceDirectory: string; since?: string }) => Promise<RpcOutput<typeof getDashboard>>;

export const POLL_MS = 3_000;

// `previous` is what the cache already holds. Polls send its version, and an
// "unchanged" reply keeps that same object, so nothing re-renders.
export function dashboardQueryOptions(fetchDashboard: FetchDashboard, hostId: string, workspaceId: string, directory: string | null, previous?: () => DashboardResult | undefined) {
  return {
    queryKey: ["progress", "dashboard", hostId, workspaceId, directory],
    queryFn: async (): Promise<DashboardResult> => {
      const last = previous?.();
      const result = await fetchDashboard({ workspaceId, workspaceDirectory: directory!, ...(last ? { since: last.version } : {}) });
      return "unchanged" in result && last ? last : result as DashboardResult;
    },
    enabled: Boolean(directory),
    staleTime: POLL_MS,
    refetchInterval: POLL_MS,
  };
}

export function useDashboard(hostId: string, workspaceId: string, directory: string | null) {
  const fetchDashboard = useRpc(getDashboard);
  const queryClient = useQueryClient();
  const options = dashboardQueryOptions(fetchDashboard, hostId, workspaceId, directory,
    () => queryClient.getQueryData<DashboardResult>(options.queryKey));
  return useQuery(options);
}
