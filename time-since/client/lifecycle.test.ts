import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { clientHarness } from '../../test-support/client-harness.mjs';
const directory = fileURLToPath(new URL('..', import.meta.url));

test('clock ticks locally, settings publish immediately, removal events remove stale watches', async () => {
  const h = clientHarness(directory);
  const stop = h.load('client/ticker.tsx').contributeClient(h.client);
  h.agents.bootstrap([{ agent: { id: 'a', workspaceId: 'w', status: 'idle' } }]);
  await h.flush();
  await h.tick(1000);
  const pill = h.registrations.find((r) => !r.removed);
  const updates = pill.updates;
  for (let i = 0; i < 10; i++) await h.tick(1000);
  assert.equal(h.requests.filter((r) => r.name === 'time-since.settings.get').length, 1);
  assert.equal(pill.updates, updates, 'minute labels should not publish every second');
  h.load('client/settings.ts').publishSettings({ showAgo: true, showIcon: true });
  assert.match(pill.button.label, / ago$/);
  h.agents.update({ kind: 'upsert', agent: { id: 'a', workspaceId: 'other', status: 'running' } });
  assert.equal(pill.removed, true);
  assert.equal(h.registrations.find((r) => !r.removed).button.visible, false);
  h.agents.update({ kind: 'remove', agentId: 'a' });
  assert.equal(h.watches.size, 0);
  assert.equal(h.registrations.filter((r) => !r.removed).length, 0);
  assert.equal(h.agents.calls, 1);
  stop();
  assert.equal(h.timers.size, 0);
  assert.equal(h.agents.listenerCount, 0);
});

test('stopping during bootstrap does not leak a timeline or pill', async () => {
  const h = clientHarness(directory);
  const stop = h.load('client/ticker.tsx').contributeClient(h.client);
  stop();
  h.agents.bootstrap([{ agent: { id: 'a', workspaceId: 'w' } }]);
  await h.flush();
  assert.equal(h.watches.size, 0);
  assert.equal(h.registrations.length, 0);
  assert.equal(h.agents.listenerCount, 0);
});
