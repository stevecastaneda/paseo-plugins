import React, { useEffect, useState } from "react";
import { View, type ViewStyle } from "react-native";

// Videos play only in Paseo's desktop app (see canPreview), which is a browser
// underneath. The plugin compiles without the DOM's types, so these are just the
// browser APIs used here.
interface VideoElement {
  preload: string;
  src: string;
  videoWidth: number;
  videoHeight: number;
  onloadedmetadata: (() => void) | null;
  onerror: (() => void) | null;
}
const browser = globalThis as unknown as {
  atob(data: string): string;
  Blob: new (parts: Uint8Array[], options: { type: string }) => VideoBlob;
  URL: { createObjectURL(blob: VideoBlob): string; revokeObjectURL(url: string): void };
  document: { createElement(tag: "video"): VideoElement };
};

// A whole video held in the app, ready to play.
export type VideoBlob = { readonly size: number };

export interface LoadedVideo {
  blob: VideoBlob;
  // Width over height, or null when the app can't read it (the box stays 16:10).
  ratio: number | null;
}

// Fetches a video piece by piece into one blob, then reads its shape.
export async function loadVideo({ bytes, mimeType, readPiece, onProgress }: {
  bytes: number;
  mimeType: string;
  readPiece(offset: number): Promise<{ data: string; bytes: number }>;
  onProgress(loaded: number): void;
}): Promise<LoadedVideo> {
  const pieces: Uint8Array[] = [];
  let loaded = 0;
  while (loaded < bytes) {
    const piece = await readPiece(loaded);
    const decoded = decode(piece.data);
    if (piece.bytes !== bytes || !decoded.length) throw new Error("the video changed while it was loading. Try again.");
    pieces.push(decoded);
    loaded += decoded.length;
    onProgress(loaded);
  }
  const blob = new browser.Blob(pieces, { type: mimeType });
  return { blob, ratio: await videoRatio(blob) };
}

function decode(data: string): Uint8Array {
  const binary = browser.atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

// Reads the size from the video's header without playing it. Gives up after a
// few seconds, so a video the app can't decode still shows its player and error.
function videoRatio(blob: VideoBlob): Promise<number | null> {
  const url = browser.URL.createObjectURL(blob);
  const video = browser.document.createElement("video");
  return new Promise<number | null>((resolve) => {
    setTimeout(() => resolve(null), 5_000);
    video.onloadedmetadata = () => resolve(video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : null);
    video.onerror = () => resolve(null);
    video.preload = "metadata";
    video.src = url;
  }).finally(() => {
    video.onloadedmetadata = video.onerror = null;
    video.src = "";
    browser.URL.revokeObjectURL(url);
  });
}

// The browser's own player, with its controls, in a box styled like an image's.
export function VideoPlayer({ video, label, style }: { video: LoadedVideo; label: string; style: ViewStyle }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const created = browser.URL.createObjectURL(video.blob);
    setUrl(created);
    return () => browser.URL.revokeObjectURL(created);
  }, [video.blob]);
  return (
    <View style={[style, { overflow: "hidden" }]}>
      {url ? <video src={url} controls playsInline aria-label={label} style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }} /> : null}
    </View>
  );
}
