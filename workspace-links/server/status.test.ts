import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { handleGetLinkStatus, probe } from "./status.ts";

async function listen(status: number) {
  const server = createServer((_request, response) => response.writeHead(status).end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function closedPortUrl() {
  const server = await listen(200);
  await server.close();
  return server.url;
}

test("any HTTP answer counts as up, even an error page", async (t) => {
  const ok = await listen(200);
  const broken = await listen(500);
  t.after(() => Promise.all([ok.close(), broken.close()]));
  assert.equal(await probe(ok.url), "up");
  assert.equal(await probe(broken.url), "up");
});

test("refused connections and silent servers are down", async (t) => {
  assert.equal(await probe(await closedPortUrl()), "down");
  const silent = createServer(() => {});
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  t.after(() => { silent.closeAllConnections(); silent.close(); });
  const { port } = silent.address() as AddressInfo;
  assert.equal(await probe(`http://127.0.0.1:${port}`, 100), "down");
});

test("statuses follow the workspace file's order and check repeated URLs once", async (t) => {
  let hits = 0;
  const server = createServer((_request, response) => { hits++; response.end(); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const up = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const down = await closedPortUrl();
  const directory = await mkdtemp(join(tmpdir(), "workspace-links-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "workspace-links.json"), JSON.stringify([
    { label: "App", url: up },
    { label: "Gone", url: down },
    { label: "Again", url: up },
  ]));
  const result = await handleGetLinkStatus({ workspaceId: "w", workspaceDirectory: directory });
  assert.deepEqual(result, { statuses: ["up", "down", "up"] });
  assert.equal(hits, 1);
});
