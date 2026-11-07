import assert from "node:assert/strict";
import { test } from "node:test";
import { displayUrl, linkIcon } from "./menu.ts";

test("URLs drop the scheme, www and a lone trailing slash", () => {
  assert.equal(displayUrl("https://m12.mortly.test"), "m12.mortly.test");
  assert.equal(displayUrl("http://firebase.m12.mortly.test/"), "firebase.m12.mortly.test");
  assert.equal(displayUrl("https://www.example.com/docs/"), "example.com/docs");
  assert.equal(displayUrl("http://localhost:3000/a?b=1"), "localhost:3000/a?b=1");
});

test("icons follow the link's name", () => {
  const icon = (label: string, url = "https://example.com") => linkIcon({ label, url });
  assert.equal(icon("App"), "AppWindow");
  assert.equal(icon("Admin"), "Shield");
  assert.equal(icon("Design System"), "Palette");
  assert.equal(icon("Firestore"), "Database");
  assert.equal(icon("Auth"), "KeyRound");
  assert.equal(icon("Storage"), "HardDrive");
  assert.equal(icon("Firebase"), "Flame");
  assert.equal(icon("API Docs"), "BookOpen");
  assert.equal(icon("adminPanel"), "Shield");
});

test("the URL decides when the name says nothing, and Globe is the fallback", () => {
  assert.equal(linkIcon({ label: "Bob", url: "http://localhost:3000/graphql" }), "Braces");
  assert.equal(linkIcon({ label: "Bob", url: "https://m12.mortly.test/__design" }), "Palette");
  assert.equal(linkIcon({ label: "Bob", url: "https://example.com" }), "Globe");
});
