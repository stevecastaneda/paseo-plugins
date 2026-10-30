import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));

type Element = { type: unknown; props: Record<string, any> };

// Renders StackedDialog by calling it, with hook state kept between calls by order.
function dialogHarness() {
  const slots: unknown[] = [];
  let slot = 0;
  let messages: unknown;
  const h = clientHarness(directory, {
    react: {
      ...React,
      useState(initial: unknown) {
        const index = slot++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
      },
      useRef(initial: unknown) {
        const index = slot++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useEffect() {},
      useContext: () => ({ locale: "en", messages }),
    },
    "@getpaseo/plugin/client": { useRpc: () => async () => ({}) },
    "@getpaseo/plugin/client/ui": { Modal: Object.assign(() => null, { Content: () => null }), Icon: () => null, useToast: () => ({}), copyText: async () => {} },
  });
  messages = h.load("client/i18n.ts").messagesFor("en");
  const { StackedDialog } = h.load("client/dialog-stack.tsx");
  const { PreviewContent } = h.load("client/preview.tsx");
  const find = (node: unknown, type: unknown): Element | undefined => {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node)) return node.map((child) => find(child, type)).find(Boolean);
    const element = node as Element;
    return element.type === type ? element : find(element.props?.children, type);
  };
  return (props: Record<string, unknown>) => {
    slot = 0;
    const modal: Element = StackedDialog(props);
    return { modal, preview: find(modal, PreviewContent) };
  };
}

test("Esc leaves a full-screen image for the preview dialog, and a second Esc closes it", () => {
  const render = dialogHarness();
  let closed = 0;
  const shot = { ref: "d1", title: "Home screen", path: "shots/home.png" };
  const props = { colors: {}, now: 0, onClose: () => closed++, context: { workspaceId: "w", workspaceDirectory: "/w" },
    root: { kind: "preview", attachment: shot, group: [shot], fullScreen: false } };

  render(props).preview!.props.onFullScreen(true);
  let { modal, preview } = render(props);
  assert.equal(preview!.props.fullScreen, true);
  assert.equal(modal.props.children.props.scrollable, false, "the dialog's scroll view would hold the image inside the dialog");

  modal.props.onOpenChange(false);
  ({ modal, preview } = render(props));
  assert.equal(closed, 0, "the dialog stays open");
  assert.equal(preview!.props.fullScreen, false);
  assert.equal(preview!.props.leftFullScreen, true, "focus goes back to the Full screen button");
  assert.equal(modal.props.open, true);

  modal.props.onOpenChange(false);
  assert.equal(closed, 1);
});

test("stepping through the gallery keeps full screen for images and drops to the dialog for other files", () => {
  const render = dialogHarness();
  const home = { ref: "d1", title: "Home screen", path: "shots/home.png" };
  const settings = { ref: "d2", title: "Settings", path: "shots/settings.png" };
  const notes = { ref: "d3", title: "Notes", path: "notes.md" };
  const props = { colors: {}, now: 0, onClose() {}, context: { workspaceId: "w", workspaceDirectory: "/w" },
    root: { kind: "preview", attachment: home, group: [home, settings, notes], fullScreen: false } };
  render(props).preview!.props.onFullScreen(true);

  render(props).preview!.props.gallery.onSelect(settings);
  assert.equal(render(props).preview!.props.fullScreen, true);
  render(props).preview!.props.gallery.onSelect(notes);
  assert.equal(render(props).preview!.props.fullScreen, false);
});
