import { useEffect, useState } from "react";

export const browser = globalThis as unknown as {
  atob(data: string): string;
  Blob: new (parts: Uint8Array[], options: { type: string }) => FileBlob;
  URL: { createObjectURL(blob: FileBlob): string; revokeObjectURL(url: string): void };
};

export type FileBlob = { readonly size: number };

export class FileChangedError extends Error {}

export async function loadPieces({ bytes, mimeType, readPiece, onProgress }: {
  bytes: number;
  mimeType: string;
  readPiece(offset: number): Promise<{ data: string; bytes: number }>;
  onProgress(loaded: number): void;
}): Promise<FileBlob> {
  const pieces: Uint8Array[] = [];
  let loaded = 0;
  while (loaded < bytes) {
    const piece = await readPiece(loaded);
    const decoded = decode(piece.data);
    if (piece.bytes !== bytes || !decoded.length) throw new FileChangedError("the file changed while it was loading. Try again.");
    pieces.push(decoded);
    loaded += decoded.length;
    onProgress(loaded);
  }
  return new browser.Blob(pieces, { type: mimeType });
}

function decode(data: string): Uint8Array {
  const binary = browser.atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function useObjectUrl(blob: FileBlob): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const created = browser.URL.createObjectURL(blob);
    setUrl(created);
    return () => browser.URL.revokeObjectURL(created);
  }, [blob]);
  return url;
}
