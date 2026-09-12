import assert from "node:assert/strict";
import { test } from "node:test";
import { linksMenuEntries, linksMenuKey } from "./menu.ts";

test("empty workspaces only offer the setup panel", () => {
  assert.deepEqual(linksMenuEntries([]), [
    { kind: "item", id: "manage-links", title: "Add links", icon: "Settings", action: "manage" },
  ]);
});

test("configured workspaces put URLs on the trigger and keep setup behind a separator", () => {
  const links = [
    { label: "App", url: "http://localhost:3000" },
    { label: "Docs", url: "https://example.com/docs" },
  ];
  assert.deepEqual(linksMenuEntries(links), [
    { kind: "item", id: "link-0", title: "App", icon: "ExternalLink", action: "open-url", url: "http://localhost:3000" },
    { kind: "item", id: "link-1", title: "Docs", icon: "ExternalLink", action: "open-url", url: "https://example.com/docs" },
    { kind: "separator", id: "manage-divider" },
    { kind: "item", id: "manage-links", title: "Manage links", icon: "Settings", action: "manage" },
  ]);
});

test("duplicate labels still get unique menu ids", () => {
  const entries = linksMenuEntries([
    { label: "App", url: "http://localhost:3000" },
    { label: "App", url: "http://localhost:3001" },
  ]);
  const ids = entries.map((entry) => entry.id);
  assert.deepEqual(ids, ["link-0", "link-1", "manage-divider", "manage-links"]);
  assert.equal(new Set(ids).size, ids.length);
});

test("menu identity changes when the directory or URLs change", () => {
  const links = [{ label: "App", url: "http://localhost:3000" }];
  const first = linksMenuKey("/workspace", links);
  assert.equal(first, linksMenuKey("/workspace", [{ label: "App", url: "http://localhost:3000" }]));
  assert.notEqual(first, linksMenuKey("/other", links));
  assert.notEqual(first, linksMenuKey("/workspace", [{ label: "Admin", url: "http://localhost:3000" }]));
  assert.notEqual(first, linksMenuKey("/workspace", []));
});
