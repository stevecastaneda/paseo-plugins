export type WorkspaceLink = { label: string; url: string };

export type LinksMenuEntry =
  | { kind: "separator"; id: string }
  | {
      kind: "item";
      id: string;
      title: string;
      icon: "ExternalLink";
      action: "open-url";
      url: string;
    }
  | {
      kind: "item";
      id: string;
      title: string;
      icon: "Settings";
      action: "manage";
    };

export function linksMenuEntries(links: readonly WorkspaceLink[]): LinksMenuEntry[] {
  const items: LinksMenuEntry[] = links.map((link, index) => ({
    kind: "item",
    id: `link-${index}`,
    title: link.label,
    icon: "ExternalLink",
    action: "open-url",
    url: link.url,
  }));
  if (items.length > 0) {
    items.push({ kind: "separator", id: "manage-divider" });
  }
  items.push({
    kind: "item",
    id: "manage-links",
    title: links.length > 0 ? "Manage links" : "Add links",
    icon: "Settings",
    action: "manage",
  });
  return items;
}

export function linksMenuKey(directory: string | undefined, links: readonly WorkspaceLink[]): string {
  return JSON.stringify({ directory: directory ?? "", links });
}
