import { stat, type FileHandle } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { readPage } from "./files.ts";

// OMP writes a fixed-width title line, then its session header. Paseo reads the
// same window when it lists OMP sessions.
const HEAD_BYTES = 64 * 1024;

type Persistence = { sessionId: string; nativeHandle?: string } | null | undefined;

// Paseo resumes an OMP chat from the session file it recorded, so read that file
// instead of searching OMP's sessions folder, which environment variables,
// profiles, settings and a repo's own .omp folder can all move. The file must
// carry an OMP header for this chat's session, so no other file is ever shown.
export async function readOmpHistory(persistence: Persistence, offset: number, source?: string) {
  const path = persistence?.nativeHandle;
  if (!path) throw new Error("This chat has no saved session yet. Send a message, then refresh.");
  if (!isAbsolute(path)) throw new Error("Paseo didn't record where this OMP chat's session file is, so History can't find its log.");
  // Chats imported before Paseo 0.16 recorded the file path as their session ID.
  const sessionId = persistence.sessionId === path ? undefined : persistence.sessionId;
  let isFile;
  try {
    isFile = (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("No raw log found for this session. It may not have been saved yet, or may have been moved or deleted.", { cause: error });
    }
    throw error;
  }
  // Opening a pipe would wait for a writer, so open only what is a regular file now.
  if (!isFile) throw new Error("The session log is not a regular file.");
  return readPage(path, offset, source, (file) => checkHeader(file, sessionId));
}

async function checkHeader(file: FileHandle, sessionId: string | undefined) {
  const head = Buffer.alloc(HEAD_BYTES);
  const { bytesRead } = await file.read(head, 0, HEAD_BYTES, 0);
  if (!bytesRead) throw new Error("This chat has no saved session yet. Send a message, then refresh.");
  const id = headerId(head.subarray(0, bytesRead).toString("utf8"));
  if (id === undefined) throw new Error("This chat's session file is not an OMP session log.");
  if (sessionId !== undefined && id !== sessionId) throw new Error("This chat's session file now holds a different OMP session. Cannot show it safely.");
}

// The ID of the first session record, or undefined when there is none or it has no ID.
function headerId(head: string): string | undefined {
  for (const line of head.split("\n")) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (!value || typeof value !== "object" || !("type" in value) || value.type !== "session") continue;
    return "id" in value && typeof value.id === "string" && value.id ? value.id : undefined;
  }
  return undefined;
}
