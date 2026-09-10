import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultShortcut, headerButtonLabel } from "../shared/shortcut.ts";

test("composer is the default placement", () => {
  assert.equal(defaultShortcut.placement, "composer");
  assert.equal(defaultShortcut.headerShowsLabel, false);
});

test("header label is omitted for the icon-only button", () => {
  assert.equal(headerButtonLabel(true), "Links");
  assert.equal(headerButtonLabel(false), undefined);
});
