import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));

test("registers the Progress panel and a Command Center item that opens it as a tab", async () => {
  const h = clientHarness(directory);
  const stop = h.load("index.client.tsx").default(h.client);
  // The harness runs plugin code in its own realm; compare plain copies.
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(h.panels.map(({ id, title, context, locations }) => ({ id, title, context, locations }))), [
    { id: "progress", title: "Progress", context: "workspace", locations: ["explorer"] },
  ]);
  const [item] = h.commandItems;
  assert.equal(item.title, "Open Progress");
  item.onSelect({ openPanel: (id: string, options?: object) => h.client.openPanel(id, { workspaceId: "w", ...options }) });
  assert.deepEqual(plain(h.openedPanels), [{ id: "progress", workspaceId: "w", location: "explorer" }], "Command Center opens the panel in Explorer");
  assert.equal(h.requests.length, 0, "nothing is read until a panel is shown");
  stop();
  assert.ok(h.panels.every((panel) => panel.removed) && h.commandItems.every((entry) => entry.removed));
});

test("the panel polls only once the workspace directory is known and shares one query per workspace", async () => {
  const { QueryClient, QueryObserver } = await import("@tanstack/react-query");
  const h = clientHarness(directory);
  const { dashboardQueryOptions, POLL_MS } = h.load("client/dashboard-query.ts");
  let calls = 0;
  const fetchDashboard = async (input: { workspaceDirectory: string }) => {
    calls++;
    return { configured: false, dashboard: { run: null, tickets: [], workspaceDirectory: input.workspaceDirectory } };
  };
  assert.equal(dashboardQueryOptions(fetchDashboard, "host", "w", null).enabled, false);
  const options = dashboardQueryOptions(fetchDashboard, "host", "w", "/w");
  assert.equal(options.enabled, true);
  assert.equal(options.refetchInterval, POLL_MS);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const first = new QueryObserver(cache, options);
  const second = new QueryObserver(cache, options);
  const stops = [first.subscribe(() => {}), second.subscribe(() => {})];
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  assert.equal((first.getCurrentResult().data as any)?.dashboard.workspaceDirectory, "/w");
  for (const stop of stops) stop();
  cache.clear();
});

test("an unchanged reply keeps the dashboard the panel already has", async () => {
  const h = clientHarness(directory);
  const { dashboardQueryOptions } = h.load("client/dashboard-query.ts");
  const held = { configured: true, dashboard: {}, panelOpened: true, version: "v1" };
  const sent: Array<{ since?: string }> = [];
  const fetchDashboard = async (input: { since?: string }) => {
    sent.push(input);
    return { unchanged: true, version: "v1" };
  };
  const options = dashboardQueryOptions(fetchDashboard, "host", "w", "/w", () => held);
  assert.equal(await options.queryFn(), held, "the same object, so nothing re-renders");
  assert.equal(sent[0].since, "v1");
});

test("tapping a question reference copies it in the reply format", () => {
  const h = clientHarness(directory, { "@getpaseo/plugin/client/react-native": {} });
  const { replyPrefix, replyWithChoice } = h.load("client/questions.tsx");
  assert.equal(replyPrefix({ id: "Q7", title: "Row spacing" }), "Q7 (Row spacing): ");
  assert.equal(replyWithChoice({ id: "Q7", title: "Row spacing" }, "B"), "Q7 (Row spacing): B", "an option's Copy button adds its letter");
});

function attentionWith(questions: number, stuck: number, run: { open?: boolean; panelOpened?: boolean } = {}) {
  return { configured: true, questions, stuck, runOpen: run.open ?? false, panelOpened: run.panelOpened ?? false };
}

test("an agent's composer shows a pill while its workspace has questions waiting or something stuck", async () => {
  const h = clientHarness(directory);
  const { contributePills, PILL_POLL_MS } = h.load("client/pills.tsx");
  h.responses["progress-dashboard.attention"] = attentionWith(2, 1);
  const stop = contributePills(h.client);
  h.agents.bootstrap([{ agent: { id: "a", workspaceId: "w" } }, { agent: { id: "idle", workspaceId: "other" } }]);
  h.workspaces.bootstrap([
    { id: "w", workspaceDirectory: "/w", projectRootPath: "/w" },
    { id: "other", workspaceDirectory: "/other", projectRootPath: "/other" },
    { id: "no-agents", workspaceDirectory: "/none", projectRootPath: "/none" },
  ]);
  await h.flush();
  const readDirectories = new Set(h.requests.map((request) => request.input.workspaceDirectory));
  assert.ok(!readDirectories.has("/none"), "workspaces without agents are not read");
  const active = () => h.registrations.filter((entry) => !entry.removed) as unknown as Array<{ agentId: string; placement: string; button: any }>;
  assert.equal(active().length, 2, "one pill per agent in a workspace that needs attention");
  const pill = active().find((entry) => entry.agentId === "a");
  assert.equal(pill?.placement, "composer");
  assert.equal(pill?.button.label, "2 questions · 1 stuck");
  assert.equal(pill?.button.behavior.kind, "popover", "the pill opens a popover with the questions");
  // The popover's Open Progress button opens the panel in Explorer.
  pill?.button.behavior.Content({ workspaceId: "w", close() {} }).props.openPanel();
  assert.deepEqual(JSON.parse(JSON.stringify(h.openedPanels)), [{ id: "progress", workspaceId: "w", location: "explorer" }]);

  h.responses["progress-dashboard.attention"] = attentionWith(1, 0);
  await h.tick(PILL_POLL_MS);
  await h.flush();
  assert.equal(active().find((entry) => entry.agentId === "a")?.button.label, "1 question");

  h.responses["progress-dashboard.attention"] = attentionWith(0, 0);
  await h.tick(PILL_POLL_MS);
  await h.flush();
  assert.equal(active().length, 0, "the pill disappears when nothing needs the user");

  stop();
  assert.equal(h.agents.listenerCount, 0);
  assert.equal(h.workspaces.listenerCount, 0);
  assert.equal(h.timers.size, 0, "no polling after cleanup");
});

test("a workspace without a progress file never shows a pill", async () => {
  const h = clientHarness(directory);
  h.responses["progress-dashboard.attention"] = { configured: false, questions: 0, stuck: 0, runOpen: false, panelOpened: false };
  const stop = h.load("client/pills.tsx").contributePills(h.client);
  h.agents.bootstrap([{ agent: { id: "a", workspaceId: "w" } }]);
  h.workspaces.bootstrap([{ id: "w", workspaceDirectory: "/w", projectRootPath: "/w" }]);
  await h.flush();
  assert.equal(h.registrations.length, 0);
  stop();
});

test("a worktree with nothing going on is checked every 30 seconds instead of every 5", async () => {
  const h = clientHarness(directory);
  const { contributePills, PILL_POLL_MS, IDLE_POLL_EVERY } = h.load("client/pills.tsx");
  h.responses["progress-dashboard.attention"] = { configured: false, questions: 0, stuck: 0, runOpen: false, panelOpened: false };
  const stop = contributePills(h.client);
  h.agents.bootstrap([{ agent: { id: "a", workspaceId: "w" } }]);
  h.workspaces.bootstrap([{ id: "w", workspaceDirectory: "/w", projectRootPath: "/w" }]);
  await h.flush();
  const reads = () => h.requests.filter((request) => request.name === "progress-dashboard.attention").length;
  const before = reads();
  for (let poll = 0; poll < IDLE_POLL_EVERY; poll++) {
    await h.tick(PILL_POLL_MS);
    await h.flush();
  }
  assert.equal(reads() - before, 1, "one check across six polls");
  stop();
});

test("a run shows a Progress pill until the panel is opened, then never again", async () => {
  const h = clientHarness(directory);
  const { contributePills, PILL_POLL_MS } = h.load("client/pills.tsx");
  const { notePanelOpened } = h.load("client/panel-opened.ts");
  const run = (panelOpened: boolean, questions = 0) => attentionWith(questions, 0, { open: true, panelOpened });
  h.responses["progress-dashboard.attention"] = run(false);
  const stop = contributePills(h.client);
  h.agents.bootstrap([{ agent: { id: "a", workspaceId: "w" } }]);
  h.workspaces.bootstrap([{ id: "w", workspaceDirectory: "/w", projectRootPath: "/w" }]);
  await h.flush();
  const active = () => h.registrations.filter((entry) => !entry.removed) as unknown as Array<{ button: any }>;
  assert.equal(active()[0]?.button.label, "Progress");
  active()[0].button.behavior.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(h.openedPanels)), [{ id: "progress", workspaceId: "w", location: "explorer" }], "pressing it opens the panel in Explorer");

  h.responses["progress-dashboard.attention"] = run(false, 2);
  await h.tick(PILL_POLL_MS);
  await h.flush();
  assert.equal(active()[0]?.button.label, "2 questions", "questions take the pill over");
  h.responses["progress-dashboard.attention"] = run(false);
  await h.tick(PILL_POLL_MS);
  await h.flush();
  assert.equal(active()[0]?.button.label, "Progress", "and hand it back while the panel hasn't been opened");

  notePanelOpened("w");
  assert.equal(active().length, 0, "opening the panel removes it at once");
  h.responses["progress-dashboard.attention"] = run(true);
  await h.tick(PILL_POLL_MS);
  await h.flush();
  assert.equal(active().length, 0);
  stop();
});

test("local deliverable paths resolve against the workspace directory", () => {
  const h = clientHarness(directory, { "@getpaseo/plugin/client/react-native": {} });
  const { absolutePath } = h.load("client/deliverables.tsx");
  assert.equal(absolutePath(".scratch/shots", "/repo/"), "/repo/.scratch/shots");
  assert.equal(absolutePath("/tmp/x.png", "/repo"), "/tmp/x.png");
  assert.equal(absolutePath("./", "/repo"), "/repo/");
});

test("the install banner shows until the command is installed and reachable", () => {
  const h = clientHarness(directory, { "@getpaseo/plugin/client/react-native": {} });
  const { launcherNotice } = h.load("client/launcher.tsx");
  const path = "/Users/s/.local/bin/paseo-progress";
  assert.equal(launcherNotice({ path, state: "missing", onPath: true }).action, "Install command");
  assert.match(launcherNotice({ path, state: "missing", onPath: true }).text, /isn't installed yet\. Installing adds one file: \/Users\/s\/\.local\/bin\/paseo-progress/);
  assert.equal(launcherNotice({ path, state: "outdated", onPath: true }).action, "Update command");
  assert.equal(launcherNotice({ path, state: "foreign", onPath: true }).action, undefined, "never offers to replace another file");
  assert.equal(launcherNotice({ path, state: "current", onPath: true }), null);
  assert.match(launcherNotice({ path, state: "current", onPath: false }).text, /need the full path/);
});
