// The panel reports here once it has recorded that it was opened, so the
// "Progress" pill goes away at once rather than on the next poll.
// The marker file is the only lasting record.
const listeners = new Set<(workspaceId: string) => void>();

export function notePanelOpened(workspaceId: string) {
  for (const listener of listeners) listener(workspaceId);
}

export function onPanelOpened(listener: (workspaceId: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
