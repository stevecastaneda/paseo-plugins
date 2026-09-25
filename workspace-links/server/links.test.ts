import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
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
  assert.deepEqual(await readLinks(directory), { configured: true, links });
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

test("loads links from workspace-links.json without calling paseo", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-links-rpc-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const links = [{ label: "App", url: "http://localhost:4321" }];
  await writeFile(join(directory, "workspace-links.json"), JSON.stringify(links));
  assert.deepEqual(
    await handleGetLinks({ workspaceId: "ws-1", workspaceDirectory: directory }, unusedPaseo()),
    { configured: true, links },
  );
});
