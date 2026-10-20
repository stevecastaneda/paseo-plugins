import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { outsideDirectory } from "./store.ts";
import { changelogNotes, headline, markWhatsNewSeen, whatsNew, whatsNewPath } from "./whats-new.ts";

const README = `# Plugin

## Install

### 2.0.0

- Not a changelog entry.

## Changelog

### 2.0.0

- **Stop** halts all work. It waits for you.
- Runs \`paseo-progress --help\`
  on a wrapped line.
  - A nested detail.

### 1.0.0

- First release.

## License
`;

async function fakeHome(t: TestContext): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "whats-new-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

// What an earlier version leaves behind once a worktree has used it.
async function earlierRun(home: string): Promise<void> {
  await mkdir(outsideDirectory(join(home, "repo"), home), { recursive: true });
}

async function seenFile(home: string): Promise<unknown> {
  return JSON.parse(await readFile(whatsNewPath(home), "utf8"));
}

test("the plugin's own README parses to the current version's notes", async () => {
  const directory = fileURLToPath(new URL("..", import.meta.url));
  const readme = await readFile(join(directory, "README.md"), "utf8");
  const { version } = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  const notes = changelogNotes(readme, version);
  assert.ok(notes && notes.length >= 4, `expected 4 or more notes for ${version}, got ${notes?.length}`);
  assert.equal(headline(notes[0]), "A new setting picks what agents do while a question waits for you.");
  assert.ok(notes.every((note) => !note.startsWith("- ") && !note.startsWith("#")));
});

test("changelog notes come from that version's section only, wrapped lines joined", () => {
  assert.deepEqual(changelogNotes(README, "2.0.0"), [
    "**Stop** halts all work. It waits for you.",
    "Runs `paseo-progress --help` on a wrapped line.",
  ]);
  assert.deepEqual(changelogNotes(README, "1.0.0"), ["First release."]);
  assert.equal(changelogNotes(README, "3.0.0"), null);
  assert.equal(changelogNotes("# Plugin\n", "2.0.0"), null);
});

test("the headline is the first sentence without Markdown", () => {
  assert.equal(headline("**Stop** halts all work. It waits for you."), "Stop halts all work.");
  assert.equal(headline("Runs `paseo-progress --help` on 1.4.0 now"), "Runs paseo-progress --help on 1.4.0 now");
  assert.equal(headline("See [the docs](https://example.com)! Then more."), "See the docs!");
});

test("an update shows the version's notes until they're dismissed", async (t) => {
  const home = await fakeHome(t);
  await earlierRun(home);
  const shown = await whatsNew({ version: "2.0.0", readme: README }, home);
  assert.deepEqual(shown, {
    version: "2.0.0",
    headline: "Stop halts all work.",
    notes: ["**Stop** halts all work. It waits for you.", "Runs `paseo-progress --help` on a wrapped line."],
  });
  assert.deepEqual(await whatsNew({ version: "2.0.0", readme: README }, home), shown, "still shown until dismissed");
  await markWhatsNewSeen("2.0.0", home);
  assert.equal(await whatsNew({ version: "2.0.0", readme: README }, home), null);
});

test("a version seen before shows the next version's notes", async (t) => {
  const home = await fakeHome(t);
  await markWhatsNewSeen("1.0.0", home);
  assert.equal((await whatsNew({ version: "2.0.0", readme: README }, home))?.version, "2.0.0");
});

test("a new install shows nothing, now or later, for its version", async (t) => {
  const home = await fakeHome(t);
  assert.equal(await whatsNew({ version: "2.0.0", readme: README }, home), null);
  assert.deepEqual(await seenFile(home), { seen: "2.0.0" });
  await earlierRun(home);
  assert.equal(await whatsNew({ version: "2.0.0", readme: README }, home), null, "its first run doesn't make it look like an update");
});

test("a damaged seen file counts as missing", async (t) => {
  const home = await fakeHome(t);
  await markWhatsNewSeen("1.0.0", home);
  await writeFile(whatsNewPath(home), "{");
  assert.equal(await whatsNew({ version: "2.0.0", readme: README }, home), null);
  assert.deepEqual(await seenFile(home), { seen: "2.0.0" });
});

test("with no notes for the version, nothing shows and nothing is recorded", async (t) => {
  const home = await fakeHome(t);
  await earlierRun(home);
  assert.equal(await whatsNew({ version: "2.0.0", readme: null }, home), null, "no README");
  assert.equal(await whatsNew({ version: "3.0.0", readme: README }, home), null, "no section");
  await assert.rejects(readFile(whatsNewPath(home)), { code: "ENOENT" });
  assert.equal((await whatsNew({ version: "2.0.0", readme: README }, home))?.version, "2.0.0", "an earlier user still sees the next notes");
});
