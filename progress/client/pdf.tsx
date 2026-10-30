import { type PluginFile, type PluginFilePanelProps, useFileUrl } from "@getpaseo/plugin/client";
import { DocumentFrame, Loading } from "@getpaseo/plugin/client/ui";
import React from "react";
import { Text, View, type ViewStyle } from "react-native";
import { errorText } from "./errors";
import { useProgressLanguage } from "./language";
import { type FileBlob, useObjectUrl } from "./pieces";

type Colors = PluginFilePanelProps["theme"]["colors"];

export function PdfFrame({ blob, style }: { blob: FileBlob; style: ViewStyle }) {
  const url = useObjectUrl(blob);
  return <View style={[style, { overflow: "hidden" }]}>{url ? <DocumentFrame url={url} /> : null}</View>;
}

export const TAB_LIMIT_BYTES: Record<"web" | "native", number> = {
  web: 100 * 1024 * 1024,
  native: 25 * 1024 * 1024,
};

export function PdfPanel({ file, layout, theme }: PluginFilePanelProps) {
  const { messages: m } = useProgressLanguage();
  const limit = TAB_LIMIT_BYTES[layout.platform === "web" ? "web" : "native"];
  if (file.size > limit) return <Note colors={theme.colors}>{m.pdfTooLarge(Math.round(file.size / 1024 / 1024))}</Note>;
  return <PdfFile file={file} colors={theme.colors} />;
}

function PdfFile({ file, colors }: { file: PluginFile; colors: Colors }) {
  const { messages: m } = useProgressLanguage();
  const url = useFileUrl(file);
  if (url.status === "loading") return <Loading />;
  if (url.status === "error") return <Note colors={colors} alert>{m.previewError(errorText(url.error, m.unknownError))}</Note>;
  return <View style={{ flex: 1, minHeight: 0 }}><DocumentFrame url={url.url} /></View>;
}

function Note({ colors, alert = false, children }: { colors: Colors; alert?: boolean; children: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text accessibilityRole={alert ? "alert" : undefined} selectable
        style={{ maxWidth: 360, textAlign: "center", color: alert ? colors.statusDanger : colors.foregroundMuted, fontSize: 13, lineHeight: 19 }}>{children}</Text>
    </View>
  );
}
