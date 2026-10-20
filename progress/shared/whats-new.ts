// A changelog bullet can open with a tag, like `- [Fixed] **Title.** Detail.`,
// that says what kind of change it is. The parser and the dialog both read
// this table. `tone` names the Paseo theme color the dialog tints the tag with.
export const NOTE_KINDS = {
  new: { label: "New", tone: "accent" },
  improved: { label: "Improved", tone: "statusSuccess" },
  fixed: { label: "Fixed", tone: "statusWarning" },
} as const;

export type NoteKind = keyof typeof NOTE_KINDS;

export type WhatsNewNote = { kind?: NoteKind; title?: string; body: string };

export type WhatsNew = { version: string; headline: string; notes: WhatsNewNote[] };
