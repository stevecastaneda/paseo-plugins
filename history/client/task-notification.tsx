import { HoverButton } from "./hover-button";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { notificationUsage, type TaskNotification } from "../shared/task-notification";
import { MarkdownMessage } from "./markdown";

export function TaskNotificationBody({ notification, colors, copy, onError }: {
  notification: TaskNotification;
  colors: PluginButtonIconProps["theme"]["colors"];
  copy(text: string): void;
  onError(message: string): void;
}) {
  const [details, setDetails] = useState(false);
  const usage = notificationUsage(notification);
  const summary = notification.summary.replace(/^Agent "(.+)" finished$/, "$1");
  return <View style={{ gap: 10 }}>
    <Text selectable style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", lineHeight: 21 }}>{summary}</Text>
    {notification.result ? <MarkdownMessage text={notification.result} colors={colors} copy={copy} onError={onError} /> : null}
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      {usage ? <Text style={{ color: colors.foregroundMuted, fontSize: 11, flexShrink: 1 }}>{usage}</Text> : null}
      {notification.result ? <HoverButton colors={colors} accessibilityRole="button" accessibilityLabel="Copy task result"
        onPress={() => copy(notification.result!)} style={({ pressed }) => ({ minHeight: 32, minWidth: 32, justifyContent: "center", alignItems: "center", opacity: pressed ? 0.6 : 1 })}>
        {color => <>
          <Icon name="Copy" size={13} color={color} />
        </>}
      </HoverButton> : null}
      <HoverButton colors={colors} accessibilityRole="button" accessibilityLabel="Task details" accessibilityState={{ expanded: details }}
        onPress={() => setDetails(!details)} style={({ pressed }) => ({ flexDirection: "row", gap: 5, alignItems: "center", minHeight: 32, paddingHorizontal: 6, opacity: pressed ? 0.6 : 1 })}>
        {color => <>
          <Icon name={details ? "ChevronDown" : "ChevronRight"} size={12} color={color} />
          <Text style={{ color, fontSize: 12 }}>Details</Text>
        </>}
      </HoverButton>
    </View>
    {details ? <View style={{ borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: 12, gap: 8 }}>
      {([
        ["Task ID", notification.taskId], ["Tool use ID", notification.toolUseId],
        ["Output file", notification.outputFile], ["Status", notification.status], ["Note", notification.note],
      ] as const).filter(([, value]) => value).map(([label, value]) => <View key={label} style={{ gap: 3 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{label}</Text>
        <Text selectable style={{ color: colors.foreground, fontSize: 12, lineHeight: 18 }}>{value}</Text>
      </View>)}
    </View> : null}
  </View>;
}
