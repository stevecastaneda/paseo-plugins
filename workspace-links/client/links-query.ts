import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import type { RpcOutput } from "@getpaseo/plugin";
import { getLinks, getLinkStatus } from "../shared/links";

type FetchLinks = (input: { workspaceId: string; workspaceDirectory: string }) => Promise<RpcOutput<typeof getLinks>>;

export function linksQueryOptions(fetchLinks: FetchLinks, hostId: string, workspaceId: string, directory: string | null) {
  return {
    queryKey: ["workspace-links", "links", hostId, workspaceId, directory],
    queryFn: () => fetchLinks({ workspaceId, workspaceDirectory: directory! }),
    enabled: Boolean(directory),
    staleTime: 2_000,
    refetchInterval: 2_000,
  };
}

export function useLinks(hostId: string, workspaceId: string, directory: string | null) {
  const fetchLinks = useRpc(getLinks);
  return useQuery(linksQueryOptions(fetchLinks, hostId, workspaceId, directory));
}

/** Polls whether each link answers, only while something on screen is showing it. */
export function useLinkStatus(hostId: string, workspaceId: string, directory: string | null) {
  const fetchStatus = useRpc(getLinkStatus);
  return useQuery({
    queryKey: ["workspace-links", "status", hostId, workspaceId, directory],
    queryFn: () => fetchStatus({ workspaceId, workspaceDirectory: directory! }),
    enabled: Boolean(directory),
    refetchInterval: 5_000,
  });
}
