import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));

type Element = { type: unknown; props: Record<string, any> };

const command = (index: number, name: string, status: string) =>
  ({ index, command: name, cwd: "/w", log: `${name} output`, status, exitCode: status === "failed" ? 1 : 0, durationMs: 1000 });

const FAILED = {
  status: "failed",
  error: "migration failed",
  detail: {
    type: "worktree_setup",
    worktreePath: "/w",
    branchName: "fix/invoice-currency",
    log: "",
    commands: [command(1, "./scripts/install-deps.sh", "completed"), command(2, "./scripts/db-migrate.sh", "failed")],
  },
};

// Renders SetupPopover with state kept in call-order slots, so a press shows on the next render.
function popover() {
  let slots: unknown[] = [];
  let cursor = 0;
  const react = {
    ...React,
    useMemo: (make: () => unknown) => make(),
    useRef: () => ({ current: null }),
    useEffect: () => {},
    useState(initial: unknown) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [slots[slot], (value: unknown) => { slots[slot] = value; }];
    },
  };
  const h = clientHarness(directory, {
    react,
    "react-native": { Platform: { OS: "web" }, View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", ActivityIndicator: "ActivityIndicator" },
    "@getpaseo/plugin/client/ui": { Icon: "Icon" },
  });
  const { SetupPopover } = h.load("client/popover.tsx");
  const props = { theme: { colors: new Proxy({}, { get: (_target, key) => String(key) }) }, snapshot: FAILED, runningSinceMs: null, onDismiss() {}, async onRunSetup() { return null; } };
  const rows = (node: any): Element[] => {
    if (Array.isArray(node)) return node.flatMap(rows);
    if (!node || typeof node !== "object") return [];
    const matches = node.type === "Pressable" && /^Show log for /.test(node.props.accessibilityLabel ?? "") ? [node] : [];
    return [...matches, ...rows(node.props.children)];
  };
  return () => {
    cursor = 0;
    return rows(SetupPopover(props));
  };
}

function chosen(rows: Element[]) {
  for (const row of rows) {
    assert.equal(row.props.accessibilityRole, "button");
    assert.equal(row.props["aria-pressed"], row.props["aria-selected"], `${row.props.accessibilityLabel}: the web and phones agree`);
  }
  return rows.filter((row) => row.props["aria-pressed"]).map((row) => row.props.accessibilityLabel);
}

test("the command rows tell screen readers on the web and on phones which log is showing", () => {
  const render = popover();
  assert.deepEqual(chosen(render()), ["Show log for ./scripts/db-migrate.sh"], "the failed command's log shows first");
  render().find((row) => row.props.accessibilityLabel === "Show log for ./scripts/install-deps.sh")!.props.onPress();
  assert.deepEqual(chosen(render()), ["Show log for ./scripts/install-deps.sh"]);
});
