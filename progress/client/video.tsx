import React from "react";
import { View, type ViewStyle } from "react-native";
import { browser, type FileBlob, useObjectUrl } from "./pieces";

interface VideoElement {
  preload: string;
  src: string;
  videoWidth: number;
  videoHeight: number;
  onloadedmetadata: (() => void) | null;
  onerror: (() => void) | null;
}
const page = globalThis as unknown as { document: { createElement(tag: "video"): VideoElement } };

// Reads the size from the video's header without playing it. Gives up after a
// few seconds, so a video the app can't decode still shows its player and error.
export function videoRatio(blob: FileBlob): Promise<number | null> {
  const url = browser.URL.createObjectURL(blob);
  const video = page.document.createElement("video");
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
export function VideoPlayer({ blob, label, style }: { blob: FileBlob; label: string; style: ViewStyle }) {
  const url = useObjectUrl(blob);
  return (
    <View style={[style, { overflow: "hidden" }]}>
      {url ? <video src={url} controls playsInline aria-label={label} style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }} /> : null}
    </View>
  );
}
