import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import React from "react";
import { Text } from "react-native";
import { formatClientAgo, formatClientClock } from "./i18n";
import { useNarrow } from "./narrow";
import { useProgressLanguage } from "./language";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// A time like "2h 15m ago" inside wrapping text moves to the next line as one
// piece instead of breaking after "2h".
export function unbroken(text: string): string {
  return text.replaceAll(" ", "\u00a0");
}

// "Sep 27, 8:14 PM (10h 2m ago)", inline inside other text. A narrow
// panel shows only "10h 2m ago"; the ticket dialog keeps the clock time.
export function When({ colors, iso, now }: { colors: Colors; iso: string; now: number }) {
  const { locale, messages: m } = useProgressLanguage();
  const ago = unbroken(formatClientAgo(locale, iso, now));
  if (useNarrow()) return <Text>{ago}</Text>;
  return (
    <Text>
      {formatClientClock(locale, iso)}<Text style={{ color: colors.foregroundMuted, opacity: 0.7 }}>{m.parenthetical(ago)}</Text>
    </Text>
  );
}
