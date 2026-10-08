import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { clientHarness } from '../../test-support/client-harness.mjs';
const directory = fileURLToPath(new URL('..', import.meta.url));

test('status polling reuses the subscribed directory and ignores removed workspace responses', async () => {
  const h = clientHarness(directory);
  let resolveStatus;
  h.client.rpc = () => new Promise((resolve) => { resolveStatus = resolve; });
  const stop = h.load('client/buttons.tsx').contributeClient(h.client);
  h.workspaces.bootstrap([{ id: 'w', workspaceKind: 'worktree' }]);
  await h.flush();
  await h.tick(2000);
  assert.equal(h.workspaces.calls, 1);
  h.workspaces.update({ kind: 'remove', id: 'w' });
  resolveStatus({ snapshot: { status: 'running' } });
  await h.flush();
  assert.equal(h.registrations.length, 0);
  stop();
  assert.equal(h.timers.size, 0);
  assert.equal(h.workspaces.listenerCount, 0);
});

test('a running setup shows a top-bar button before the worktree has any agent', async () => {
  const h = clientHarness(directory);
  h.client.rpc = async () => ({ snapshot: { status: 'running', detail: { commands: [], log: '' } } });
  const stop = h.load('client/buttons.tsx').contributeClient(h.client);
  h.workspaces.bootstrap([{ id: 'w', workspaceKind: 'worktree' }]);
  await h.flush();
  assert.equal(h.registrations.length, 1);
  assert.equal(h.registrations[0].placement, 'header');
  assert.equal(h.registrations[0].workspaceId, 'w');
  assert.equal(h.registrations[0].button.behavior.kind, 'popover');
  assert.equal(h.openedPanels.length, 0, 'setup no longer opens a tab on its own');
  stop();
});
