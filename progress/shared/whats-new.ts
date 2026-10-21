// A changelog bullet can open with a tag, like `- [Fixed] **Title.** Detail.`,
// that says what kind of change it is. The parser and the dialog both read
// this table. `tone` is the hue the dialog colors the tag with.
export const NOTE_KINDS = {
  new: { label: "New", tone: "green" },
  improved: { label: "Improved", tone: "violet" },
  fixed: { label: "Fixed", tone: "amber" },
} as const;

export type NoteTone = (typeof NOTE_KINDS)[NoteKind]["tone"];

export type NoteKind = keyof typeof NOTE_KINDS;

export type WhatsNewNote = { kind?: NoteKind; title?: string; body: string };

export type WhatsNewRelease = { version: string; notes: WhatsNewNote[] };

// `version` is the one running now; `releases` run newest first and are never empty.
export type WhatsNew = { version: string; headline: string; releases: WhatsNewRelease[] };
