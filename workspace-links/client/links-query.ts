import { useEffect } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import type { RpcOutput } from "@getpaseo/plugin";
import { getLinks } from "../shared/links";
import { publishLinks } from "./links-state";

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
  const query = useQuery(linksQueryOptions(fetchLinks, hostId, workspaceId, directory));
  useEffect(() => {
    if (directory && query.data) publishLinks(workspaceId, directory, query.data.links);
  }, [workspaceId, directory, query.data]);
  return query;
}
