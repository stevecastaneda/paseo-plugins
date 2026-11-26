import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import React from "react";
import { Text, View } from "react-native";
import type { TicketProgress } from "../shared/dashboard";
import { formatClientAgo, formatClientEta, formatClientPercent } from "./i18n";
import { useProgressLanguage } from "./language";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// How far a job on the ticket says it is, filling the bar.
export function ReportedBar({ colors, percent, height }: { colors: Colors; percent: number; height: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height, borderRadius: height / 2, overflow: "hidden", backgroundColor: colors.surface2 }}
    >
      <View style={{ width: `${percent}%`, height: "100%", backgroundColor: colors.accent }} />
    </View>
  );
}

// Under the ticket's title in the list: "73%", a slim bar and the time left,
// then the job's own line.
export function ReportedProgressLine({ colors, progress, now }: { colors: Colors; progress: TicketProgress; now: number }) {
  const { messages: m, locale } = useProgressLanguage();
  const eta = progress.eta ? formatClientEta(locale, progress.eta, now) : null;
  return (
    <View style={{ gap: 2, paddingTop: 2 }}>
      {progress.percent !== undefined || eta ? (
        <View
          accessible
          accessibilityLabel={[progress.percent !== undefined ? m.reportedProgress(formatClientPercent(locale, progress.percent)) : "", eta?.left ?? ""]
            .filter(Boolean)
            .join(m.listSeparator)}
          style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          {progress.percent !== undefined ? (
            <>
              <Text style={{ color: colors.foreground, fontSize: 12, lineHeight: 17, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
                {formatClientPercent(locale, progress.percent)}
              </Text>
              <View style={{ flex: 1, minWidth: 24, maxWidth: 160 }}>
                <ReportedBar colors={colors} percent={progress.percent} height={4} />
              </View>
            </>
          ) : null}
          {eta ? (
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 1,
                color: eta.past ? colors.statusWarning : colors.foregroundMuted,
                fontSize: 12,
                lineHeight: 17,
                fontVariant: ["tabular-nums"],
              }}
            >
              {eta.left}
            </Text>
          ) : null}
        </View>
      ) : null}
      {progress.detail ? (
        <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
          {progress.detail}
        </Text>
      ) : null}
    </View>
  );
}

// The ticket dialog's summary: the percent large, a full-width bar, when it
// should be done, the job's own line, and when it last reported.
export function ReportedProgressPanel({ colors, progress, now }: { colors: Colors; progress: TicketProgress; now: number }) {
  const { messages: m, locale } = useProgressLanguage();
  const eta = progress.eta ? formatClientEta(locale, progress.eta, now) : null;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
        {progress.percent !== undefined ? (
          <Text
            accessibilityLabel={m.reportedProgress(formatClientPercent(locale, progress.percent))}
            style={{ color: colors.foreground, fontSize: 28, lineHeight: 32, fontWeight: "600", fontVariant: ["tabular-nums"] }}
          >
            {formatClientPercent(locale, progress.percent)}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {eta ? (
          <View accessibilityLiveRegion="polite" style={{ alignItems: "flex-end", flexShrink: 1 }}>
            <Text
              numberOfLines={1}
              style={{
                color: eta.past ? colors.statusWarning : colors.foreground,
                fontSize: 14,
                lineHeight: 19,
                fontWeight: "600",
                fontVariant: ["tabular-nums"],
              }}
            >
              {eta.left}
            </Text>
            <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17, fontVariant: ["tabular-nums"] }}>
              {eta.around}
            </Text>
          </View>
        ) : null}
      </View>
      {progress.percent !== undefined ? (
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress.percent) }}>
          <ReportedBar colors={colors} percent={progress.percent} height={10} />
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Text style={{ flex: 1, minWidth: 0, color: colors.foreground, fontSize: 13, lineHeight: 18 }}>{progress.detail ?? ""}</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{m.reportedAgo(formatClientAgo(locale, progress.at, now))}</Text>
      </View>
    </View>
  );
}
