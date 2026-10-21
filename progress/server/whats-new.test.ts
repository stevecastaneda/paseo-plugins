import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { outsideDirectory } from "./store.ts";
import { changelog, headline, markWhatsNewSeen, whatsNew, whatsNewPath } from "./whats-new.ts";

const README = `# Plugin

## Install

### 2.0.0

- Not a changelog entry.

## Changelog

### 2.0.0

- **Questions can pause work.** Pick **Stop** in
  Settings.
- **Stop** halts all work. It waits for you.
- Runs \`paseo-progress --help\`
  on a wrapped line.
  - A nested detail.

### 1.10.0

- [Fixed] **Faster.** Half the wait.
- [New] **Questions can wait.** Agents keep working.

### 1.9.0

- [New] **Older news.** Already seen.

### 1.0.0

- First release.

## License
`;

function changelogNotes(readme: string, version: string) {
  return changelog(readme).find((release) => release.version === version)?.notes ?? null;
}

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

async function ownReadme(): Promise<{ readme: string; version: string }> {
  const directory = fileURLToPath(new URL("..", import.meta.url));
  const readme = await readFile(join(directory, "README.md"), "utf8");
  const { version } = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  return { readme, version };
}

// What's new shows this entry to users after they update, so a release can't
// ship without one in the shape the dialog draws.
test("the current version has a changelog entry ready for What's new", async () => {
  const { readme, version } = await ownReadme();
  const notes = changelogNotes(readme, version);
  assert.ok(notes?.length, `README.md needs a "### ${version}" entry under "## Changelog"`);
  for (const note of notes) {
    assert.ok(note.kind && note.title && note.body && !note.body.includes("[") && !note.title.includes("*"),
      `each ${version} bullet needs the form "- [New|Improved|Fixed] **Short title.** Detail", got: ${note.title ?? ""} ${note.body}`);
  }
});

test("the 1.4.0 entry leads with the question modes", async () => {
  const { readme } = await ownReadme();
  const notes = changelogNotes(readme, "1.4.0");
  assert.ok(notes && notes.length >= 4);
  assert.equal(headline(notes[0]), "Choose what agents do while a question waits.");
});

const NOTES = [
  { title: "Questions can pause work.", body: "Pick **Stop** in Settings." },
  { body: "**Stop** halts all work. It waits for you." },
  { body: "Runs `paseo-progress --help` on a wrapped line." },
];

test("changelog notes come from that version's section only, wrapped lines joined", () => {
  assert.deepEqual(changelogNotes(README, "2.0.0"), NOTES);
  assert.deepEqual(changelogNotes(README, "1.0.0"), [{ body: "First release." }]);
  assert.equal(changelogNotes(README, "3.0.0"), null);
  assert.equal(changelogNotes("# Plugin\n", "2.0.0"), null);
});

test("the changelog lists versions newest first, by number", () => {
  assert.deepEqual(changelog(README).map((release) => release.version), ["2.0.0", "1.10.0", "1.9.0", "1.0.0"]);
  assert.deepEqual(changelog("# Plugin\n"), []);
});

test("a bullet's bold opening sentence is its title, without Markdown", () => {
  const titled = (bullet: string) => changelogNotes(`## Changelog\n\n### 1.0.0\n\n- ${bullet}\n`, "1.0.0")?.[0];
  assert.deepEqual(titled("**Ready?** Then go."), { title: "Ready?", body: "Then go." });
  assert.deepEqual(titled("**Only a title.**"), { title: "Only a title.", body: "" });
  assert.deepEqual(titled("**Stop** halts all work."), { body: "**Stop** halts all work." }, "bold that isn't a sentence");
  assert.deepEqual(titled("Uses **Stop.** now."), { body: "Uses **Stop.** now." }, "bold that doesn't open the bullet");
});

test("a leading [New], [Improved] or [Fixed] tag sets the note's kind, in any case", () => {
  const tagged = (bullet: string) => changelogNotes(`## Changelog\n\n### 1.0.0\n\n- ${bullet}\n`, "1.0.0")?.[0];
  assert.deepEqual(tagged("[New] **Ready?** Then go."), { kind: "new", title: "Ready?", body: "Then go." });
  assert.deepEqual(tagged("[improved] **Faster.** Half the wait."), { kind: "improved", title: "Faster.", body: "Half the wait." });
  assert.deepEqual(tagged("[FIXED] Bold text shows."), { kind: "fixed", body: "Bold text shows." });
  assert.deepEqual(tagged("[Beta] **Try it.** Soon."), { body: "[Beta] **Try it.** Soon." }, "an unknown tag stays text");
  assert.deepEqual(tagged("Uses [New] mid-sentence."), { body: "Uses [New] mid-sentence." }, "a tag that doesn't open the bullet");
  assert.deepEqual(tagged("**Ready?** Then go."), { title: "Ready?", body: "Then go." }, "no tag, no kind");
  assert.equal(headline(tagged("[Fixed] **Bold text shows.** It used to be plain.")!), "Bold text shows.");
  assert.equal(headline(tagged("[Fixed] Bold text shows. It used to be plain.")!), "Bold text shows.");
});

test("notes show typeset quotes, except in code", () => {
  const notes = changelogNotes(`## Changelog\n\n### 1.0.0\n\n- **It's here.** Reads "Waiting for you" ('soon'), not \`echo "it's"\`.\n`, "1.0.0");
  assert.deepEqual(notes, [{ title: "It\u2019s here.", body: "Reads \u201cWaiting for you\u201d (\u2018soon\u2019), not `echo \"it's\"`." }]);
});

test("the headline is the title, or else the body's first sentence without Markdown", () => {
  assert.equal(headline({ title: "Questions can pause work.", body: "Pick **Stop**. Then wait." }), "Questions can pause work.");
  assert.equal(headline({ body: "**Stop** halts all work. It waits for you." }), "Stop halts all work.");
  assert.equal(headline({ body: "Runs `paseo-progress --help` on 1.4.0 now" }), "Runs paseo-progress --help on 1.4.0 now");
  assert.equal(headline({ body: "See [the docs](https://example.com)! Then more." }), "See the docs!");
});

test("an update shows the version's notes until they're dismissed", async (t) => {
  const home = await fakeHome(t);
  await markWhatsNewSeen("1.10.0", home);
  const shown = await whatsNew({ version: "2.0.0", readme: README }, home);
  assert.deepEqual(shown, {
    version: "2.0.0",
    headline: "Questions can pause work.",
    releases: [{ version: "2.0.0", notes: NOTES }],
  });
  assert.deepEqual(await whatsNew({ version: "2.0.0", readme: README }, home), shown, "still shown until dismissed");
  await markWhatsNewSeen("2.0.0", home);
  assert.equal(await whatsNew({ version: "2.0.0", readme: README }, home), null);
});

test("skipping updates shows every version missed, newest first", async (t) => {
  const home = await fakeHome(t);
  await markWhatsNewSeen("1.9.0", home);
  const shown = await whatsNew({ version: "2.0.0", readme: README }, home);
  assert.deepEqual(shown?.releases.map((release) => release.version), ["2.0.0", "1.10.0"]);
  assert.equal(shown?.version, "2.0.0");
  assert.equal(shown?.headline, "Questions can wait.", "the first New note leads, even from an older version");
});

test("going from 1.4.0 to 1.5.1 shows 1.5.1 and 1.5.0", async (t) => {
  const home = await fakeHome(t);
  const { readme } = await ownReadme();
  await markWhatsNewSeen("1.4.0", home);
  const shown = await whatsNew({ version: "1.5.1", readme }, home);
  assert.deepEqual(shown?.releases.map((release) => release.version), ["1.5.1", "1.5.0"]);
});

test("an update from before versions were recorded shows this version only", async (t) => {
  const home = await fakeHome(t);
  await earlierRun(home);
  const shown = await whatsNew({ version: "2.0.0", readme: README }, home);
  assert.deepEqual(shown?.releases.map((release) => release.version), ["2.0.0"]);
});

test("going back to an older version shows nothing", async (t) => {
  const home = await fakeHome(t);
  await markWhatsNewSeen("2.0.0", home);
  assert.equal(await whatsNew({ version: "1.10.0", readme: README }, home), null);
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

test("a seen version that isn't x.y.z counts as missing", async (t) => {
  for (const seen of ["1.6", "v1.6.0", ""]) {
    const home = await fakeHome(t);
    await earlierRun(home);
    await writeFile(whatsNewPath(home), JSON.stringify({ seen }));
    const shown = await whatsNew({ version: "2.0.0", readme: README }, home);
    assert.deepEqual(shown?.releases.map((release) => release.version), ["2.0.0"], seen);
    await markWhatsNewSeen("2.0.0", home);
    assert.equal(await whatsNew({ version: "2.0.0", readme: README }, home), null, seen);
  }
});

test("with no notes for the version, nothing shows and nothing is recorded", async (t) => {
  const home = await fakeHome(t);
  await earlierRun(home);
  assert.equal(await whatsNew({ version: "2.0.0", readme: null }, home), null, "no README");
  assert.equal(await whatsNew({ version: "3.0.0", readme: README }, home), null, "no section");
  await assert.rejects(readFile(whatsNewPath(home)), { code: "ENOENT" });
  assert.equal((await whatsNew({ version: "2.0.0", readme: README }, home))?.version, "2.0.0", "an earlier user still sees the next notes");
});
