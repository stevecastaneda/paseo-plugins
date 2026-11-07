import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { displayUrl } from "../shared/menu.ts";
import { handleGetLinks, readLinks } from "./links.ts";

function unusedPaseo(): PluginHandlerContext {
  return {
    paseo: new Proxy({} as PluginHandlerContext["paseo"], {
      get() {
        throw new Error("handleGetLinks must not call paseo");
      },
    }),
  };
}

test("reads each workspace's own file and refreshes generated links", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-links-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.deepEqual(await readLinks(directory), { configured: false, links: [] });
  const links = [{ label: "App", url: "http://localhost:4321" }];
  await writeFile(join(directory, "workspace-links.json"), JSON.stringify(links));
  assert.deepEqual(await readLinks(directory), { configured: true, links: [{ label: "App", url: "http://localhost:4321/" }] });
  await writeFile(join(directory, "workspace-links.json"), "[]");
  assert.deepEqual(await readLinks(directory), { configured: true, links: [] });
});

test("malformed files and non-web URLs produce a useful error", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-links-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const contents of ["not json", "{}", '[{"label":"Bad","url":"javascript:alert(1)"}]']) {
    await writeFile(join(directory, "workspace-links.json"), contents);
    await assert.rejects(readLinks(directory), /array of links/);
  }
});

test("a link shows the site it opens, however its address is written", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-links-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "workspace-links.json");
  for (const url of [
    "https://github.com@evil.example/login",
    "https:///github.com@evil.example/login",
    "https://\\github.com@evil.example/login",
    "https://user:pass@www.example.com/a",
  ]) {
    await writeFile(file, JSON.stringify([{ label: "GitHub", url }]));
    await assert.rejects(readLinks(directory), /name before an @/, url);
  }
  await writeFile(file, JSON.stringify([{ label: "Docs", url: "HTTPS:///Example.com\\guide?x=@github.com" }]));
  const { links } = await readLinks(directory);
  assert.equal(displayUrl(links[0]!.url), "example.com/guide?x=@github.com");
});

test("refuses a symlinked or oversized file, even when its contents are valid links", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-links-"));
  const outside = await mkdtemp(join(tmpdir(), "workspace-links-outside-"));
  t.after(() => Promise.all([directory, outside].map((path) => rm(path, { recursive: true, force: true }))));
  const links = JSON.stringify([{ label: "App", url: "http://localhost:4321" }]);
  await writeFile(join(outside, "links.json"), links);
  await symlink(join(outside, "links.json"), join(directory, "workspace-links.json"));
  await assert.rejects(readLinks(directory), /regular file/);

  await rm(join(directory, "workspace-links.json"));
  await writeFile(join(directory, "workspace-links.json"), links + " ".repeat(64 * 1024));
  await assert.rejects(readLinks(directory), /64 KB/);
});

test("loads links from workspace-links.json without calling paseo", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-links-rpc-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const links = [{ label: "App", url: "http://localhost:4321/" }];
  await writeFile(join(directory, "workspace-links.json"), JSON.stringify(links));
  assert.deepEqual(
    await handleGetLinks({ workspaceId: "ws-1", workspaceDirectory: directory }, unusedPaseo()),
    { configured: true, links },
  );
});
