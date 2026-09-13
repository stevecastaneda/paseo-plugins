import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { clientHarness } from '../../test-support/client-harness.mjs';
const directory = fileURLToPath(new URL('..', import.meta.url));

test('status polling reuses subscribed directories and ignores removed workspace responses', async () => {
  const h = clientHarness(directory);
  let resolveStatus;
  h.client.rpc = () => new Promise((resolve) => { resolveStatus = resolve; });
  const stop = h.load('client/pills.tsx').contributeClient(h.client);
  h.agents.bootstrap([{ agent: { id: 'a', workspaceId: 'w' } }]);
  h.workspaces.bootstrap([{ id: 'w', workspaceKind: 'worktree' }]);
  await h.flush();
  await h.tick(2000);
  assert.equal(h.agents.calls, 1);
  assert.equal(h.workspaces.calls, 1);
  h.workspaces.update({ kind: 'remove', id: 'w' });
  resolveStatus({ snapshot: { status: 'running' } });
  await h.flush();
  assert.equal(h.registrations.length, 0);
  assert.equal([...h.timers.values()].some((timer) => timer.delay === 1200), false);
  stop();
  assert.equal(h.timers.size, 0);
  assert.equal(h.agents.listenerCount, 0);
  assert.equal(h.workspaces.listenerCount, 0);
});
