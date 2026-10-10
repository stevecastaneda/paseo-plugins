import type { RpcOutput } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPulse, type PulseResult } from "../shared/rpc";

type FetchPulse = (input: { workspaceId: string; workspaceDirectory: string; since?: string }) => Promise<RpcOutput<typeof getPulse>>;

// Every second while tests run, so steps feel live; slower once the run is over.
export const LIVE_POLL_MS = 1_000;
export const IDLE_POLL_MS = 5_000;

export function pollInterval(result: PulseResult | undefined): number {
  const status = result?.run?.status;
  return status === "starting" || status === "running" ? LIVE_POLL_MS : IDLE_POLL_MS;
}

export function pulseQueryKey(hostId: string, workspaceId: string, directory: string | null) {
  return ["playwright-pulse", "run", hostId, workspaceId, directory];
}

// Polls send the version the cache already holds, and an "unchanged" reply
// keeps that same object, so nothing re-renders.
export function usePulse(hostId: string, workspaceId: string, directory: string | null) {
  const fetchPulse: FetchPulse = useRpc(getPulse);
  const queryClient = useQueryClient();
  const queryKey = pulseQueryKey(hostId, workspaceId, directory);
  return useQuery({
    queryKey,
    queryFn: async (): Promise<PulseResult> => {
      const last = queryClient.getQueryData<PulseResult>(queryKey);
      const result = await fetchPulse({ workspaceId, workspaceDirectory: directory!, ...(last ? { since: last.version } : {}) });
      return "unchanged" in result && last ? last : (result as PulseResult);
    },
    enabled: Boolean(directory),
    staleTime: LIVE_POLL_MS,
    refetchInterval: (query) => pollInterval(query.state.data),
  });
}
