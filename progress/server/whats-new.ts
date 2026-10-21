// After an update, the panel shows what changed since the version last seen,
// once. The notes come from the changelog in the plugin's own README, so
// they're written in one place. Which version was seen is kept per user on
// this computer.
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { NOTE_KINDS, type NoteKind, type WhatsNew, type WhatsNewNote, type WhatsNewRelease } from "../shared/whats-new.ts";
import { spans } from "../shared/write-up.ts";
import { findPluginDirectory } from "./skill.ts";
import { stateRoot, writeAtomic } from "./store.ts";

export type Release = { version: string; readme: string | null };

const seenSchema = z.object({ seen: z.string() });
const packageSchema = z.object({ version: z.string() });

export function whatsNewPath(home = homedir()): string {
  return join(stateRoot(home), "whats-new.json");
}

// Each `### x.y.z` under the README's `## Changelog` with its top-level
// bullets, newest first. Versions without bullets are left out.
export function changelog(readme: string): WhatsNewRelease[] {
  const releases: { version: string; bullets: string[] }[] = [];
  let inChangelog = false;
  let current: string[] | null = null;
  for (const line of readme.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^##\s/.test(line)) {
      inChangelog = line.trim() === "## Changelog";
      current = null;
      continue;
    }
    if (!inChangelog) continue;
    if (/^###\s/.test(line)) {
      const version = /^###\s+(\d+\.\d+\.\d+)\s*$/.exec(line)?.[1];
      current = null;
      if (version) releases.push({ version, bullets: (current = []) });
    } else if (current && /^[-*]\s/.test(line)) current.push(line.slice(2).trim());
    else if (current?.length && /^\s+\S/.test(line) && !/^\s+([-*+]|\d+[.)])\s/.test(line)) {
      current[current.length - 1] += ` ${line.trim()}`;
    }
  }
  return releases
    .filter((release) => release.bullets.length)
    .map(({ version, bullets }) => ({ version, notes: bullets.map(note) }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map((version) => version.split(".").map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

// A bullet can open with a kind tag, like `[Fixed]`, and then a bold
// sentence, like `**Title.** Detail.`, which is its title.
function note(bullet: string): WhatsNewNote {
  const tag = /^\[([a-z]+)\]\s*(.*)$/i.exec(bullet);
  const kind = tag ? noteKind(tag[1]) : undefined;
  const rest = kind ? tag![2] : bullet;
  const text = rest.split(/(`[^`]+`)/).map((part, index) => index % 2 ? part : curly(part)).join("");
  const lead = /^\*\*([^*]+?[.!?])\*\*\s*(.*)$/.exec(text);
  return { ...(kind && { kind }), ...(lead ? { title: plain(lead[1]), body: lead[2] } : { body: text }) };
}

function noteKind(tag: string): NoteKind | undefined {
  const key = tag.toLowerCase();
  return Object.hasOwn(NOTE_KINDS, key) ? key as NoteKind : undefined;
}

// The README is typed with straight quotes; the panel shows typeset ones. Code keeps its own.
function curly(text: string): string {
  return text.replace(/(^|[\s([{])"/g, "$1\u201c").replace(/"/g, "\u201d").replace(/(^|[\s([{])'/g, "$1\u2018").replace(/'/g, "\u2019");
}

function plain(markdown: string): string {
  return spans(markdown).map((span) => span.text).join("");
}

// A note's title, or else the first sentence of its body, without Markdown.
export function headline(note: WhatsNewNote): string {
  if (note.title) return note.title;
  const body = plain(note.body);
  return /^.*?[.!?](?=\s|$)/.exec(body)?.[0] ?? body;
}

async function readSeen(home: string): Promise<string | null> {
  try {
    return seenSchema.parse(JSON.parse(await readFile(whatsNewPath(home), "utf8"))).seen;
  } catch {
    return null;
  }
}

export async function markWhatsNewSeen(version: string, home = homedir()): Promise<void> {
  await writeAtomic(whatsNewPath(home), `${JSON.stringify({ seen: version })}\n`);
}

// A worktree's folder (see outsideDirectory) means the plugin was in use
// before this version, so this is an update, not a new install.
async function usedBefore(home: string): Promise<boolean> {
  const entries = await readdir(stateRoot(home), { withFileTypes: true }).catch(() => []);
  return entries.some((entry) => entry.isDirectory() && /-[0-9a-f]{8}$/.test(entry.name));
}

// What to show, or null: every version since the one last seen, newest
// first. A new install has nothing to catch up on, so it records this version
// as seen. An update from before versions were recorded can't say where it
// started, so it shows this version alone rather than the whole history.
export async function whatsNew({ version, readme }: Release, home = homedir()): Promise<WhatsNew | null> {
  const seen = await readSeen(home);
  if (seen === version) return null;
  if (seen === null && !(await usedBefore(home))) {
    await markWhatsNewSeen(version, home);
    return null;
  }
  const releases = (readme === null ? [] : changelog(readme)).filter((release) => seen === null
    ? release.version === version
    : compareVersions(release.version, seen) > 0 && compareVersions(release.version, version) <= 0);
  if (!releases.length) return null;
  const notes = releases.flatMap((release) => release.notes);
  return { version, headline: headline(notes.find((note) => note.kind === "new") ?? notes[0]), releases };
}

// The server bundle can't read files beside it, so ask Paseo where the plugin
// is. Read once per load: an update reloads the bundle, which starts over.
let release: Promise<Release> | null = null;

function currentRelease(): Promise<Release> {
  release ??= findPluginDirectory().then(async (directory) => ({
    version: packageSchema.parse(JSON.parse(await readFile(join(directory, "package.json"), "utf8"))).version,
    readme: await readFile(join(directory, "README.md"), "utf8").catch(() => null),
  }));
  release.catch(() => {
    release = null;
  });
  return release;
}

export async function handleGetWhatsNew(): Promise<WhatsNew | null> {
  return whatsNew(await currentRelease());
}

export async function handleDismissWhatsNew(input: { version: string }) {
  await markWhatsNewSeen(input.version);
  return {};
}
