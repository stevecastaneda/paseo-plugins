export type PageParams = { workspaceId: string; workspaceDirectory: string; ref: string; title: string };

// Panels can't open a screen themselves, only the plugin's client can, so it
// sets this once it has added the page screen.
export let openPage: ((params: PageParams) => void) | null = null;

export function setPageOpener(opener: typeof openPage) {
  openPage = opener;
}
