// Anything the user can open from the dashboard: a deliverable ("D3") or a
// file on a question ("Q7.2", counting from 1). The panel lists them and the
// server finds them by the same reference, so both read it from here.
import type { Dashboard, Deliverable, Question } from "./dashboard.ts";

export interface Attachment {
  ref: string;
  title: string;
  path?: string;
  url?: string;
  // What the agent said a deliverable is. Question files don't have one.
  kind?: Deliverable["kind"];
}

export function deliverableAttachment(deliverable: Deliverable): Attachment {
  return { ref: deliverable.id, title: deliverable.title, path: deliverable.path, url: deliverable.url, kind: deliverable.kind };
}

export function questionAttachments(question: Question): Attachment[] {
  return question.files.map((file, index) => ({
    ref: `${question.id}.${index + 1}`,
    title: file.label ?? (file.path ?? file.url ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "",
    path: file.path,
    url: file.url,
  }));
}

// The attachment a reference names, or null when it names nothing.
export function findAttachment(dashboard: Dashboard, ref: string): Attachment | null {
  const question = ref.match(/^(Q\d+)\./);
  if (question) {
    const found = [...dashboard.questions.open, ...dashboard.questions.answered].find((candidate) => candidate.id === question[1]);
    return (found && questionAttachments(found).find((attachment) => attachment.ref === ref)) ?? null;
  }
  const deliverable = dashboard.deliverables.find((candidate) => candidate.id === ref);
  return deliverable ? deliverableAttachment(deliverable) : null;
}

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

// Plain text shown as-is in the preview dialog, and opened in the browser on
// the host. HTML is left to the browser either way.
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt", ".log", ".json", ".jsonl", ".yaml", ".yml", ".csv"]);

function extension(path: string): string | null {
  return path.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? null;
}

// The image type of a path by its extension, or null when it isn't an image.
export function imageMimeType(path: string): string | null {
  return IMAGE_TYPES[extension(path) ?? ""] ?? null;
}

export function previewKind(path: string): "image" | "text" | null {
  if (imageMimeType(path)) return "image";
  return TEXT_EXTENSIONS.has(extension(path) ?? "") ? "text" : null;
}

// Whether the preview dialog can show it. Only a browser draws SVG: Paseo's
// desktop app can, the phone apps' image view can't, so there an SVG opens on
// the host like any other file.
export function canPreview(attachment: Attachment, where: { browser: boolean }): boolean {
  if (!attachment.path) return false;
  const kind = previewKind(attachment.path);
  if (kind === "image" && extension(attachment.path) === ".svg") return where.browser;
  return kind !== null;
}

const KIND_ICON: Record<NonNullable<Deliverable["kind"]>, string> = {
  file: "File",
  folder: "Folder",
  report: "FileChartColumn",
  screenshot: "Image",
  link: "Globe",
};

// One icon per attachment, the same on every screen. What the agent called a
// deliverable wins; otherwise the file itself decides.
export function attachmentIcon(attachment: Attachment): string {
  if (attachment.kind && attachment.kind !== "file") return KIND_ICON[attachment.kind];
  if (attachment.url) return "Globe";
  if (!attachment.path) return "File";
  const kind = previewKind(attachment.path);
  return kind === "image" ? "Image" : kind === "text" ? "FileText" : /[\/]$/.test(attachment.path) ? "Folder" : "File";
}

// The short name people recognize: a file or folder's own name, or a link's site.
export function shortName(attachment: Attachment): string {
  if (attachment.url) {
    try { return new URL(attachment.url).host.replace(/^www\./, ""); } catch { return attachment.url; }
  }
  return (attachment.path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
}
