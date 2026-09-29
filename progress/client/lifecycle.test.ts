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

test("on a phone, where Paseo doesn't draw Explorer, Progress opens as a tab", () => {
  const h = clientHarness(directory, { "react-native": { Platform: { OS: "ios" } } });
  const stop = h.load("index.client.tsx").default(h.client);
  assert.deepEqual(JSON.parse(JSON.stringify(h.panels.map(({ id, locations }) => ({ id, locations })))), [{ id: "progress-tab", locations: ["workspace"] }],
    "its own id, so a tab an older version left in the phone's hidden Explorer pane isn't reused");
  h.commandItems[0].onSelect({ openPanel: (id: string, options?: object) => h.client.openPanel(id, { workspaceId: "w", ...options }) });
  assert.deepEqual(JSON.parse(JSON.stringify(h.openedPanels)), [{ id: "progress-tab", workspaceId: "w", location: "workspace" }]);
  stop();
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

test("one rule decides what the pill shows, its icon, and whether pressing it opens the popover", () => {
  const { pillFor, isIdle } = clientHarness(directory).load("client/pill-state.ts");
  const report = (questions: number, stuck: number, runOpen: boolean, panelOpened: boolean) => ({ configured: true, questions, stuck, runOpen, panelOpened });
  const desktop = { phone: false };
  const phone = { phone: true };
  const cases: Array<[string, unknown, { phone: boolean }, unknown]> = [
    ["no progress file", { ...report(2, 1, true, false), configured: false }, desktop, null],
    ["questions and stuck", report(2, 1, true, true), desktop, { mode: "attention", label: "2 questions · 1 stuck", icon: "stuck" }],
    ["one question, even after the run closed", report(1, 0, false, true), desktop, { mode: "attention", label: "1 question", icon: "questions" }],
    ["a new run's panel never opened", report(0, 0, true, false), desktop, { mode: "started", label: "Progress", icon: "started" }],
    ["panel opened, desktop has Explorer", report(0, 0, true, true), desktop, null],
    ["panel opened, a phone needs the way in", report(0, 0, true, true), phone, { mode: "open", label: "Progress", icon: "open" }],
    ["a phone after the run finished", report(0, 0, false, true), phone, null],
  ];
  for (const [name, input, where, expected] of cases) {
    assert.deepEqual(JSON.parse(JSON.stringify(pillFor(input, where))), expected, name);
  }
  assert.equal(pillFor(undefined, desktop), null, "not read yet");
  assert.equal(isIdle(report(0, 0, false, true)), true);
  assert.equal(isIdle(report(1, 0, false, true)), false, "a question left on a closed run still counts");
});

test("an agent's composer shows a pill while its workspace has questions waiting or something stuck", async () => {
  const h = clientHarness(directory);
  const { contributePills, PILL_POLL_MS } = h.load("client/pills.tsx");
  h.responses["progress.attention"] = attentionWith(2, 1);
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

  h.responses["progress.attention"] = attentionWith(1, 0);
  await h.tick(PILL_POLL_MS);
  await h.flush();
  assert.equal(active().find((entry) => entry.agentId === "a")?.button.label, "1 question");

  h.responses["progress.attention"] = attentionWith(0, 0);
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
  h.responses["progress.attention"] = { configured: false, questions: 0, stuck: 0, runOpen: false, panelOpened: false };
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
  h.responses["progress.attention"] = { configured: false, questions: 0, stuck: 0, runOpen: false, panelOpened: false };
  const stop = contributePills(h.client);
  h.agents.bootstrap([{ agent: { id: "a", workspaceId: "w" } }]);
  h.workspaces.bootstrap([{ id: "w", workspaceDirectory: "/w", projectRootPath: "/w" }]);
  await h.flush();
  const reads = () => h.requests.filter((request) => request.name === "progress.attention").length;
  const before = reads();
  for (let poll = 0; poll < IDLE_POLL_EVERY; poll++) {
    await h.tick(PILL_POLL_MS);
    await h.flush();
  }
  assert.equal(reads() - before, 1, "one check across six polls");
  stop();
});

test("an agent update checks a worktree whose last run is closed, so a new run's question shows soon", async () => {
  const h = clientHarness(directory);
  const { contributePills } = h.load("client/pills.tsx");
  h.responses["progress.attention"] = attentionWith(0, 0);
  const stop = contributePills(h.client);
  h.agents.bootstrap([{ agent: { id: "a", workspaceId: "w" } }]);
  h.workspaces.bootstrap([{ id: "w", workspaceDirectory: "/w", projectRootPath: "/w" }]);
  await h.flush();
  const reads = () => h.requests.filter((request) => request.name === "progress.attention").length;
  const before = reads();
  const realNow = Date.now;
  Date.now = () => realNow() + 60_000;
  try {
    h.responses["progress.attention"] = attentionWith(1, 0, { open: true, panelOpened: true });
    h.agents.update({ kind: "upsert", agent: { id: "a", workspaceId: "w" } });
    await h.flush();
  } finally {
    Date.now = realNow;
  }
  assert.equal(reads() - before, 1);
  assert.equal((h.registrations.find((entry) => !entry.removed) as any)?.button.label, "1 question");
  stop();
});

test("a run shows a Progress pill until the panel is opened, then never again", async () => {
  const h = clientHarness(directory);
  const { contributePills, PILL_POLL_MS } = h.load("client/pills.tsx");
  const { notePanelOpened } = h.load("client/panel-opened.ts");
  const run = (panelOpened: boolean, questions = 0) => attentionWith(questions, 0, { open: true, panelOpened });
  h.responses["progress.attention"] = run(false);
  const stop = contributePills(h.client);
  h.agents.bootstrap([{ agent: { id: "a", workspaceId: "w" } }]);
  h.workspaces.bootstrap([{ id: "w", workspaceDirectory: "/w", projectRootPath: "/w" }]);
  await h.flush();
  const active = () => h.registrations.filter((entry) => !entry.removed) as unknown as Array<{ button: any }>;
  assert.equal(active()[0]?.button.label, "Progress");
  active()[0].button.behavior.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(h.openedPanels)), [{ id: "progress", workspaceId: "w", location: "explorer" }], "pressing it opens the panel in Explorer");

  h.responses["progress.attention"] = run(false, 2);
  await h.tick(PILL_POLL_MS);
  await h.flush();
  assert.equal(active()[0]?.button.label, "2 questions", "questions take the pill over");
  h.responses["progress.attention"] = run(false);
  await h.tick(PILL_POLL_MS);
  await h.flush();
  assert.equal(active()[0]?.button.label, "Progress", "and hand it back while the panel hasn't been opened");

  notePanelOpened("w");
  assert.equal(active().length, 0, "opening the panel removes it at once");
  h.responses["progress.attention"] = run(true);
  await h.tick(PILL_POLL_MS);
  await h.flush();
  assert.equal(active().length, 0);
  stop();
});

test("on a phone, an open run keeps a Progress pill that opens the panel as a tab", async () => {
  const h = clientHarness(directory, { "react-native": { Platform: { OS: "ios" } } });
  const { contributePills, PILL_POLL_MS } = h.load("client/pills.tsx");
  h.responses["progress.attention"] = attentionWith(0, 0, { open: true, panelOpened: true });
  const stop = contributePills(h.client);
  h.agents.bootstrap([{ agent: { id: "a", workspaceId: "w" } }]);
  h.workspaces.bootstrap([{ id: "w", workspaceDirectory: "/w", projectRootPath: "/w" }]);
  await h.flush();
  const active = () => h.registrations.filter((entry) => !entry.removed) as unknown as Array<{ button: any }>;
  assert.equal(active()[0]?.button.label, "Progress", "shown even after the panel has been opened");
  active()[0].button.behavior.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(h.openedPanels)), [{ id: "progress-tab", workspaceId: "w", location: "workspace" }]);
  h.responses["progress.attention"] = attentionWith(0, 0, { open: false, panelOpened: true });
  await h.tick(PILL_POLL_MS);
  await h.flush();
  assert.equal(active().length, 0, "a finished run has no pill");
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
