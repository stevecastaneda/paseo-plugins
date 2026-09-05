import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLinks } from "./links.server.ts";

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

test("OS launch commands keep URL punctuation out of executable code", async () => {
  const { browserCommand } = await import("./browser.server.ts");
  const url = "https://example.com/?q=$('test')&other=%22quoted%22";
  assert.deepEqual(browserCommand(url, "darwin"), { file: "/usr/bin/open", args: [url] });
  assert.deepEqual(browserCommand(url, "linux"), { file: "xdg-open", args: [url] });
  const windows = browserCommand(url, "win32");
  assert.match(windows.file, /powershell\.exe$/);
  assert.equal(windows.args.join(" ").includes(url), false);
  assert.match(windows.args.at(-1)!, /\$env:PASEO_WORKSPACE_LINK_URL/);
  assert.throws(() => browserCommand("javascript:alert(1)", "win32"));
});

test("launcher hides the console, passes the URL as data, and surfaces failures", async () => {
  const { launchUrl } = await import("./browser.server.ts");
  const url = "https://example.com/?a=1&b=2";
  const run = (async (_file: string, _args: string[], options: Record<string, unknown>) => {
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.equal((options.env as Record<string, string>).PASEO_WORKSPACE_LINK_URL, url);
    return { stdout: "", stderr: "" };
  }) as Parameters<typeof launchUrl>[1];
  await launchUrl(url, run);
  const failing = (async () => { throw new Error("unavailable"); }) as Parameters<typeof launchUrl>[1];
  await assert.rejects(launchUrl(url, failing), /default browser/);
});
