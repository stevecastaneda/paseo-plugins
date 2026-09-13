import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { clientHarness } from "../../test-support/client-harness.mjs";

test("registers once per agent, follows workspace moves, and cleans up", async () => {
  const h = clientHarness(fileURLToPath(new URL("..", import.meta.url)));
  const stop = h.load("index.client.tsx").default(h.client);
  h.agents.bootstrap([{ agent: { id: "a", workspaceId: "w" } }]); await h.flush();
  assert.equal(h.registrations.length, 1);
  assert.equal(h.registrations[0].button.label, "History");
  assert.equal(h.registrations[0].button.behavior.kind, "action");
  assert.equal(h.registrations[0].button.behavior.onPress(), undefined);
  h.agents.update({ kind: "upsert", agent: { id: "a", workspaceId: "w" } });
  assert.equal(h.registrations.length, 1);
  h.agents.update({ kind: "upsert", agent: { id: "a", workspaceId: "w2" } });
  assert.equal(h.registrations[0].removed, true);
  assert.equal(h.registrations[1].workspaceId, "w2");
  h.agents.update({ kind: "remove", agentId: "a" });
  assert.equal(h.registrations[1].removed, true);
  stop(); assert.equal(h.agents.listenerCount, 0); assert.equal(h.timers.size, 0);
});

test("does not register pills after stopping during the initial fetch", async () => {
  const h = clientHarness(fileURLToPath(new URL("..", import.meta.url)));
  const stop = h.load("index.client.tsx").default(h.client); stop();
  h.agents.bootstrap([{ agent: { id: "a", workspaceId: "w" } }]); await h.flush();
  assert.equal(h.registrations.length, 0);
});
