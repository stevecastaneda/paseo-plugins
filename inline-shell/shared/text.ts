// The last path segment, for either slash style; the client has no node:path.
export function basename(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

// Errors cross a realm boundary in tests and an RPC boundary in the app, so `instanceof Error` is not reliable.
export function errorMessage(error: unknown): string {
  return typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : String(error);
}
