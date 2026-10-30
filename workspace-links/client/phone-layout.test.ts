import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));

type Node = { type: unknown; props: Record<string, any> } | string | number | null | undefined | boolean | Node[];
type Element = { type: unknown; props: Record<string, any> };

const LINKS = [
  { label: "App", url: "http://localhost:3000" },
  { label: "Docs", url: "http://localhost:4000/docs" },
];

// Renders the real components with just enough of React's hooks: state lives in call-order slots,
// effects run once after a render, and a function child of a Pressable gets the idle press state.
function renderer(modules: Record<string, unknown>) {
  let slots: unknown[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const react = {
    ...React,
    useMemo: (make: () => unknown) => make(),
    useCallback: (fn: unknown) => fn,
    useState(initial: unknown) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [slots[slot], (value: unknown) => {
        slots[slot] = typeof value === "function" ? (value as (current: unknown) => unknown)(slots[slot]) : value;
      }];
    },
    useEffect(effect: () => void) {
      const slot = cursor++;
      if (!(slot in slots)) {
        slots[slot] = true;
        effects.push(effect);
      }
    },
  };
  const h = clientHarness(directory, {
    react,
    "react-native": {
      Platform: { OS: "web" },
      View: "View",
      Text: "Text",
      Pressable: "Pressable",
      ScrollView: "ScrollView",
      ActivityIndicator: "ActivityIndicator",
    },
    "@getpaseo/plugin/client/ui": { Icon: "Icon", copyText: async () => {}, useToast: () => ({ error() {} }) },
    ...modules,
  });
  const expand = (node: Node): Node => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") return expand((node.type as (props: unknown) => Node)(node.props));
    const children = typeof node.props.children === "function" ? node.props.children({ hovered: false, pressed: false }) : node.props.children;
    return { type: node.type, props: { ...node.props, children: expand(children) } };
  };
  return {
    load: h.load,
    async render(Component: (props: unknown) => Node, props: unknown) {
      for (let pass = 0; pass < 3; pass++) {
        cursor = 0;
        expand(Component(props));
        const pending = effects;
        effects = [];
        pending.forEach((effect) => effect());
        await h.flush();
      }
      cursor = 0;
      return expand(Component(props));
    },
  };
}

function all(node: Node, matches: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => all(child, matches));
  if (!node || typeof node !== "object") return [];
  return [...(matches(node) ? [node] : []), ...all(node.props.children, matches)];
}

function text(node: Node): string[] {
  return all(node, (element) => element.type === "Text").map((element) => [element.props.children].flat().filter((child) => typeof child === "string" || typeof child === "number").join(""));
}

function flat(style: unknown): Record<string, unknown> {
  return Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : style && typeof style === "object" ? style as Record<string, unknown> : {};
}

function pressable(tree: Node, name: string): Record<string, any> & { style: Record<string, unknown> } {
  const [match] = all(tree, (element) => element.type === "Pressable" && (element.props.accessibilityLabel === name || text(element).includes(name)));
  assert.ok(match, `${name} is on screen`);
  return { ...match.props, style: flat(typeof match.props.style === "function" ? match.props.style({ hovered: false, pressed: false }) : match.props.style) };
}

const hostProps = (compact: boolean) => ({
  theme: { colors: new Proxy({}, { get: (_target, key) => String(key) }) },
  host: { id: "h", label: "MacBook Pro" },
  layout: { compact, platform: "web" },
  workspaceId: "w",
});

async function popover(compact: boolean) {
  const r = renderer({
    "@getpaseo/plugin/client": { useWorkspace: () => "/w", useRpc: () => async () => ({}), openExternalUrl: async () => {} },
    "@tanstack/react-query": {
      useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[1] === "links" ? { links: LINKS } : { statuses: ["up", "down"] } }),
    },
  });
  const { LinksPopover } = r.load("client/popover.tsx");
  return r.render(LinksPopover, { ...hostProps(compact), close() {}, onManage() {} });
}

// Each call renders the same panel again, so state such as an open picker carries over.
function panelRenderer(compact: boolean, settings: { placement: string; headerShowsLabel: boolean }) {
  const r = renderer({
    "@getpaseo/plugin/client": { useWorkspace: () => "/w", useRpc: () => async () => settings, openExternalUrl: async () => {} },
    "@tanstack/react-query": { useQuery: () => ({ data: { configured: true, links: LINKS }, isPending: false }) },
  });
  const { LinksPanel } = r.load("client/panel.tsx");
  return () => r.render(LinksPanel, hostProps(compact));
}

function panel(compact: boolean, settings: { placement: string; headerShowsLabel: boolean }) {
  return panelRenderer(compact, settings)();
}

test("the desktop popover keeps its Links title and count, and shows copy buttons on hover", async () => {
  const tree = await popover(false);
  assert.ok(text(tree).includes("Links"));
  assert.ok(text(tree).includes("2"));
  assert.equal(pressable(tree, "Manage links").accessibilityRole, "button");
  assert.equal(pressable(tree, "Copy App URL").style.opacity, 0, "copy waits for hover with a mouse");
});

test("the phone sheet drops the repeated title, keeps Manage links, and shows copy buttons at 44pt", async () => {
  const tree = await popover(true);
  assert.ok(!text(tree).includes("Links"), "Paseo's sheet already says Workspace Links");
  const manage = pressable(tree, "Manage links");
  assert.ok((manage.style.minHeight as number) >= 44);
  const copy = pressable(tree, "Copy App URL");
  assert.notEqual(copy.style.opacity, 0, "a phone browser has no hover to reveal it");
  assert.equal(copy.style.width, 44);
  assert.equal(copy.style.height, 44);
});

test("the Show label switch reports on and off to screen readers on desktop", async () => {
  for (const headerShowsLabel of [true, false]) {
    const tree = await panel(false, { placement: "header", headerShowsLabel });
    const toggle = pressable(tree, "Show label");
    assert.equal(toggle.accessibilityRole, "switch");
    assert.equal(toggle["aria-checked"], headerShowsLabel);
  }
});

test("phones get no Show label switch, and the Show as picker is 44pt", async () => {
  const tree = await panel(true, { placement: "header", headerShowsLabel: false });
  assert.equal(all(tree, (element) => element.props.accessibilityRole === "switch").length, 0);
  assert.equal(pressable(tree, "Show as, Header Button").style.minHeight, 44);
  const desktop = await panel(false, { placement: "header", headerShowsLabel: false });
  assert.equal(pressable(desktop, "Show as, Header Button").style.minHeight, undefined, "desktop keeps the compact picker");
});

test("the open Show as picker tells screen readers on the web and on phones which choice is picked", async () => {
  for (const [placement, picked] of [["header", "Header Button"], ["composer", "Composer Pill"]]) {
    const render = panelRenderer(false, { placement, headerShowsLabel: false });
    pressable(await render(), `Show as, ${picked}`).onPress();
    const tree = await render();
    for (const name of ["Header Button", "Composer Pill"]) {
      const [choice] = all(tree, (element) => element.type === "Pressable" && !element.props.accessibilityLabel && text(element).join("") === name);
      assert.ok(choice, `${name} is in the open picker`);
      assert.equal(choice.props.accessibilityRole, "button");
      assert.equal(choice.props["aria-pressed"], name === picked, "Chromium reads aria-pressed on a button");
      assert.equal(choice.props["aria-selected"], name === picked, "phones read aria-selected");
    }
  }
});
