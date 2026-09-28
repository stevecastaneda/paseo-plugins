const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

// The image type of a path by its extension, or null when it isn't a previewable image.
export function imageMimeType(path: string): string | null {
  const match = path.toLowerCase().match(/\.[a-z0-9]+$/);
  return (match && IMAGE_TYPES[match[0]]) ?? null;
}

// Plain text shown as-is in the preview dialog. HTML is left to the browser.
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt", ".log", ".json", ".jsonl", ".yaml", ".yml", ".csv"]);

export function previewKind(path: string): "image" | "text" | null {
  if (imageMimeType(path)) return "image";
  const match = path.toLowerCase().match(/\.[a-z0-9]+$/);
  return match && TEXT_EXTENSIONS.has(match[0]) ? "text" : null;
}
