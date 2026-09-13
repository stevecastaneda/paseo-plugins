import type { WorkspaceLink } from "../shared/menu";
type Listener = (workspaceId: string, directory: string, links: WorkspaceLink[]) => void;
const listeners = new Set<Listener>();
export function publishLinks(workspaceId: string, directory: string, links: WorkspaceLink[]) {
  for (const listener of listeners) listener(workspaceId, directory, links);
}
export function subscribeLinks(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
