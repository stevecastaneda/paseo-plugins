import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));
const phone = { "react-native": { Platform: { OS: "ios" } } };
// The harness runs plugin code in its own realm; compare plain copies.
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test("the pill's title carries the run status, so the phone menu row shows it", async () => {
  const h = clientHarness(directory);
  let brief: object = { runId: "r", status: "running", done: 25, total: 47, failed: 0 };
  h.responses["pulse.briefs"] = { get briefs() { return { "/w": brief }; } };
  const stop = h.load("index.client.tsx").default(h.client);
  h.workspaces.bootstrap([{ id: "w", workspaceDirectory: "/w", projectRootPath: "/w" }]);
  await h.flush();
  const [pill] = h.registrations;
  assert.equal(pill.button.title, "Playwright Pulse: Tests 25/47");

  brief = { runId: "r", status: "running", done: 26, total: 47, failed: 1 };
  await h.tick(2_000);
  await h.flush();
  assert.equal(pill.button.label, "1 failed · 26/47");
  assert.equal(pill.button.title, "Playwright Pulse: 1 failed · 26/47");

  const updates = pill.updates;
  await h.tick(2_000);
  await h.flush();
  assert.equal(pill.updates, updates, "an unchanged pill isn't updated, so its spinner keeps turning");
  stop();
});
