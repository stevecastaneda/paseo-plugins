// After an update, the panel shows what changed in this version, once. The
// notes come from the changelog in the plugin's own README, so they're
// written in one place. Whether they've been seen is kept per user on this
// computer.
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { WhatsNew, WhatsNewNote } from "../shared/rpc.ts";
import { spans } from "../shared/write-up.ts";
import { findPluginDirectory } from "./skill.ts";
import { stateRoot, writeAtomic } from "./store.ts";

export type Release = { version: string; readme: string | null };

const seenSchema = z.object({ seen: z.string() });
const packageSchema = z.object({ version: z.string() });

export function whatsNewPath(home = homedir()): string {
  return join(stateRoot(home), "whats-new.json");
}

// The top-level bullets under `### <version>` in the README's `## Changelog`,
// or null when that version has none.
export function changelogNotes(readme: string, version: string): WhatsNewNote[] | null {
  let section: "other" | "changelog" | "version" = "other";
  const notes: string[] = [];
  for (const line of readme.replace(/\r\n?/g, "\n").split("\n")) {
    if (section === "version" && /^#{2,3}\s/.test(line)) break;
    if (/^##\s/.test(line)) section = line.trim() === "## Changelog" ? "changelog" : "other";
    else if (section === "changelog" && line.trim() === `### ${version}`) section = "version";
    else if (section === "version" && /^[-*]\s/.test(line)) notes.push(line.slice(2).trim());
    else if (section === "version" && notes.length && /^\s+\S/.test(line) && !/^\s+([-*+]|\d+[.)])\s/.test(line)) {
      notes[notes.length - 1] += ` ${line.trim()}`;
    }
  }
  return notes.length ? notes.map(note) : null;
}

// A bullet that opens with a bold sentence, like `**Title.** Detail.`, has a title.
function note(bullet: string): WhatsNewNote {
  const lead = /^\*\*([^*]+?[.!?])\*\*\s*(.*)$/.exec(bullet);
  return lead ? { title: plain(lead[1]), body: lead[2] } : { body: bullet };
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

// What to show, or null. A new install has nothing to catch up on, so it
// records this version as seen.
export async function whatsNew({ version, readme }: Release, home = homedir()): Promise<WhatsNew | null> {
  const notes = readme === null ? null : changelogNotes(readme, version);
  if (!notes) return null;
  const seen = await readSeen(home);
  if (seen === version) return null;
  if (seen === null && !(await usedBefore(home))) {
    await markWhatsNewSeen(version, home);
    return null;
  }
  return { version, headline: headline(notes[0]), notes };
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
