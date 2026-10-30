import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as ReactNativeWeb from 'react-native-web';
import * as ReactQuery from '@tanstack/react-query';
import { clientHarness } from '../../test-support/client-harness.mjs';
const directory = fileURLToPath(new URL('..', import.meta.url));

test('the options tab is titled Time Since, and Command Center still offers Time Since Options', () => {
  const h = clientHarness(directory);
  h.load('index.client.tsx').default(h.client)();
  assert.deepEqual(h.panels.map((panel) => panel.title), ['Time Since']);
  assert.deepEqual(h.commandItems.map((item) => item.title), ['Time Since Options']);
});

test('each switch tells screen readers whether it is on, in the web and desktop apps', () => {
  const h = clientHarness(directory, {
    'react-native': ReactNativeWeb,
    '@tanstack/react-query': ReactQuery,
    '@getpaseo/plugin/client': { useRpc: () => async () => assert.fail('settings come from the cache') },
    '@getpaseo/plugin/client/ui': { Icon: () => null },
  });
  const { TimeSinceOptionsPanel } = h.load('client/settings-panel.tsx');
  const queryClient = new ReactQuery.QueryClient();
  queryClient.setQueryData(['time-since', 'settings', 'host'], { showIcon: true, showAgo: false });
  const html = renderToStaticMarkup(React.createElement(ReactQuery.QueryClientProvider, { client: queryClient },
    React.createElement(TimeSinceOptionsPanel, { theme: { colors: {} }, host: { id: 'host', label: 'MacBook Pro' } })));
  const switches = [...html.matchAll(/<[^>]*role="switch"[^>]*>/g)].map(([tag]) => ({
    label: tag.match(/aria-label="([^"]*)"/)?.[1],
    checked: tag.match(/aria-checked="([^"]*)"/)?.[1] ?? null,
  }));
  assert.deepEqual(switches, [
    { label: 'Show clock icon', checked: 'true' },
    { label: 'Show “ago” suffix', checked: 'false' },
  ]);
});
