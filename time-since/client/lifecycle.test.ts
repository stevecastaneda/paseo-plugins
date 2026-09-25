import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { clientHarness } from '../../test-support/client-harness.mjs';
const directory = fileURLToPath(new URL('..', import.meta.url));

test('clock ticks locally, settings publish immediately, removal events remove stale watches', async () => {
  const h = clientHarness(directory);
  const stop = h.load('client/ticker.tsx').contributeClient(h.client);
  h.agents.bootstrap([
    {
      agent: {
        id: 'a',
        workspaceId: 'w',
        status: 'idle',
        lastUserMessageAt: new Date(Date.now() - 600_000).toISOString(),
      },
    },
  ]);
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

test('directory agents seed from the snapshot without a timeline read', async () => {
  const h = clientHarness(directory);
  const stop = h.load('client/ticker.tsx').contributeClient(h.client);
  const lastUserMessageAt = new Date(Date.now() - 120_000).toISOString();
  h.agents.bootstrap([
    {
      agent: {
        id: 'a',
        workspaceId: 'w',
        status: 'idle',
        lastUserMessageAt,
        createdAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      },
    },
    {
      agent: {
        id: 'b',
        workspaceId: 'w',
        status: 'idle',
        lastUserMessageAt: null,
        createdAt: new Date(Date.now() - 90_000).toISOString(),
      },
    },
  ]);
  await h.flush();
  assert.deepEqual(
    h.requests.map((r) => r.name).sort(),
    ['time-since.last-reply.list', 'time-since.settings.get'],
    'a directory snapshot must not trigger a per-agent read',
  );
  const pillFor = (agentId) => h.registrations.find((r) => !r.removed && r.agentId === agentId);
  assert.match(pillFor('a').button.label, /^2m/, 'seeds from lastUserMessageAt, not createdAt');
  assert.match(pillFor('b').button.label, /^1m/, 'falls back to createdAt');
  assert.deepEqual([...h.watches.keys()], ['a', 'b']);

  // A rename/label/attention update moves updatedAt and carries an older
  // createdAt, but lastUserMessageAt is unchanged; the seed must not move.
  h.agents.update({
    kind: 'upsert',
    agent: {
      id: 'a',
      workspaceId: 'w',
      status: 'idle',
      lastUserMessageAt,
      createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      updatedAt: new Date().toISOString(),
      title: 'renamed',
    },
  });
  assert.match(pillFor('a').button.label, /^2m/);

  // The live timeline subscription still advances the pill.
  h.watches.get('a')({
    timestamp: new Date(Date.now() - 30_000).toISOString(),
    event: { type: 'timeline', item: { type: 'assistant_message' } },
  });
  await h.tick(1000);
  assert.match(pillFor('a').button.label, /^3[0-9]s/);
  stop();
});

test('recorded turn ends seed the pill with the last reply, even when they arrive late', async () => {
  const h = clientHarness(directory);
  let settleReplies;
  h.responses['time-since.last-reply.list'] = new Promise((resolve) => { settleReplies = resolve; });
  const stop = h.load('client/ticker.tsx').contributeClient(h.client);
  const agent = (id) => ({
    id,
    workspaceId: 'w',
    status: 'idle',
    lastUserMessageAt: new Date(Date.now() - 20 * 60_000).toISOString(),
  });
  h.agents.bootstrap([{ agent: agent('a') }, { agent: agent('b') }, { agent: agent('c') }]);
  await h.flush();
  const pillFor = (agentId) => h.registrations.find((r) => !r.removed && r.agentId === agentId);
  assert.match(pillFor('a').button.label, /^20m/, 'falls back to lastUserMessageAt until the ledger loads');

  settleReplies({
    lastReplyAt: {
      a: new Date(Date.now() - 2 * 60_000).toISOString(),
      // A recorded turn older than a newer user message must not win.
      b: new Date(Date.now() - 45 * 60_000).toISOString(),
      gone: new Date().toISOString(),
    },
  });
  await h.flush();
  assert.match(pillFor('a').button.label, /^2m/, 'seeds from the recorded turn end');
  assert.match(pillFor('b').button.label, /^20m/);
  assert.match(pillFor('c').button.label, /^20m/, 'agents without a recorded turn keep the fallback');
  assert.equal(
    h.requests.filter((r) => r.name === 'time-since.last-reply.list').length,
    1,
    'one ledger read serves every agent',
  );

  // Agents registered after the ledger loads seed from it too.
  h.agents.update({ kind: 'upsert', agent: { ...agent('gone'), lastUserMessageAt: null } });
  assert.match(pillFor('gone').button.label, /^0s/);
  stop();
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
