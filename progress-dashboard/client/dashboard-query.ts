import { useRpc } from "@getpaseo/plugin/client";
import type { RpcOutput } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import { getDashboard } from "../shared/rpc";

type FetchDashboard = (input: { workspaceId: string; workspaceDirectory: string }) => Promise<RpcOutput<typeof getDashboard>>;

export const POLL_MS = 3_000;

export function dashboardQueryOptions(fetchDashboard: FetchDashboard, hostId: string, workspaceId: string, directory: string | null) {
  return {
    queryKey: ["progress-dashboard", "dashboard", hostId, workspaceId, directory],
    queryFn: () => fetchDashboard({ workspaceId, workspaceDirectory: directory! }),
    enabled: Boolean(directory),
    staleTime: POLL_MS,
    refetchInterval: POLL_MS,
  };
}

export function useDashboard(hostId: string, workspaceId: string, directory: string | null) {
  const fetchDashboard = useRpc(getDashboard);
  return useQuery(dashboardQueryOptions(fetchDashboard, hostId, workspaceId, directory));
}
