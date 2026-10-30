import { type PluginButtonContentProps, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import React, { useRef, useState } from "react";
import { Text, View } from "react-native";
import type { Dashboard } from "../shared/dashboard";
import { useDashboard } from "./dashboard-query";
import { PressScale } from "./motion";
import { type Attachment, isPreviewable, useAttachmentOpener } from "./attachments";
import { StackedDialog } from "./dialog-stack";
import { galleryFiles } from "./preview";
import { QuestionDetail, QuestionState, useCopy } from "./questions";
import { errorText } from "./errors";
import { raised, withAlpha } from "./surfaces";
import { useProgressLanguage } from "./language";

type Colors = PluginButtonContentProps["theme"]["colors"];
type Question = Dashboard["questions"]["open"][number];

// On desktop, Paseo caps the popover at 440px and scrolls all of it, padding included. The
// list scrolls on its own below that cap so Open Progress stays in view.
const LIST_MAX_HEIGHT = 340;
const HEADER_GAP = 12;
const TOUCH_TARGET = 44;

// Paseo unmounts the popover when it closes, so reopening comes back to where the user was.
const shownQuestions = new Map<string, string>();

// What the pill opens: the open questions with their Copy buttons, and anything
// stuck, so the user can answer without leaving the chat.
export function AttentionPopover({ theme, host, layout, workspaceId, close, openPanel }: PluginButtonContentProps & { openPanel(): void }) {
  const { messages: m } = useProgressLanguage();
  const colors = theme.colors;
  // Paseo draws the desktop popover on surface1 and the phone sheet on surface0.
  const onSurface1 = !layout.compact;
  // The phone apps are pressed with a finger.
  const touch = layout.platform !== "web";
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const query = useDashboard(host.id, workspaceId, directory);
  const dashboard = query.data?.configured ? query.data.dashboard : null;
  // Stored paths are relative to the worktree root, which can sit above the workspace directory.
  const root = query.data?.root ?? directory ?? "";
  const copy = useCopy();
  // Previews open in a dialog over the popover, which stays open to return to.
  // Links and other files leave Paseo, so the popover closes for those.
  const [previewing, setPreviewing] = useState<{ attachment: Attachment; group: Attachment[] } | null>(null);
  const group = useRef<Attachment[]>([]);
  const opener = useAttachmentOpener({ workspaceId, workspaceDirectory: root, onPreview: (attachment) => setPreviewing({ attachment, group: galleryFiles(group.current) }) });
  return (
    <View style={{ width: 360, maxWidth: "100%", gap: 8 }}>
      {dashboard ? (
        <AttentionList colors={colors} dashboard={dashboard} workspaceId={workspaceId} compact={layout.compact} touch={touch} onSurface1={onSurface1}
          onCopy={async (question, letter) => {
            await copy(question, letter);
            close();
          }} onOpenAttachment={(attachment, from) => {
            group.current = from;
            if (!isPreviewable(attachment)) close();
            void opener.open(attachment);
          }} />
      ) : (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
          {query.error ? m.readProgressError(errorText(query.error, m.unknownError)) : m.loading}
        </Text>
      )}
      <StackedDialog colors={colors} now={Date.now()} onClose={() => setPreviewing(null)} context={{ workspaceId, workspaceDirectory: root }}
        root={previewing ? { kind: "preview", ...previewing, fullScreen: false } : null} />
      <View style={{ paddingTop: touch ? 12 : 8, borderTopWidth: 1, borderTopColor: colors.border }}>
        {/* A full 44pt touch target on phones; desktop keeps the compact button. */}
        <PressScale accessibilityRole="button" onPress={() => { close(); openPanel(); }}
          style={({ pressed }) => ({ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: touch ? 8 : 6, paddingVertical: 6, minHeight: touch ? TOUCH_TARGET : undefined, borderRadius: touch ? 8 : 4, ...raised(colors),
            backgroundColor: onSurface1 ? (pressed ? colors.surface1 : colors.surface2) : pressed ? colors.surface2 : colors.surface1 })}>
          {/* Beside the chat on desktop; on a phone it opens as its own tab, shown with the tab's icon. */}
          <Icon name={touch ? "ListChecks" : "PanelRight"} size={touch ? 16 : 12} color={colors.foreground} />
          <Text style={{ color: colors.foreground, fontSize: touch ? 15 : 12, lineHeight: touch ? 20 : 16, fontWeight: "600" }}>{m.openProgress}</Text>
        </PressScale>
      </View>
    </View>
  );
}

// On a phone the popover is a sheet that already scrolls, and sizes itself to
// whichever scroll view reports last. Paseo 0.10.1 turns a ScrollView inside it
// into one of those, so a short list would shrink the sheet to its title.
function List({ compact, maxHeight, surface, children }: { compact: boolean; maxHeight: number; surface: string; children: React.ReactNode }) {
  const [moreBelow, setMoreBelow] = useState(false);
  const size = useRef({ viewport: 0, content: 0, offset: 0 });
  if (compact) return <View style={{ gap: 12 }}>{children}</View>;
  const measure = (next: Partial<typeof size.current>) => {
    const s = Object.assign(size.current, next);
    const below = s.offset + s.viewport < s.content - 1;
    if (below !== moreBelow) setMoreBelow(below);
  };
  return (
    <View style={{ position: "relative" }}>
      <ScrollView style={{ maxHeight }} contentContainerStyle={{ gap: 12 }} scrollEventThrottle={16}
        onLayout={(event) => measure({ viewport: event.nativeEvent.layout.height })}
        onContentSizeChange={(_, height) => measure({ content: height })}
        onScroll={(event) => measure({ offset: event.nativeEvent.contentOffset.y })}>
        {children}
      </ScrollView>
      {moreBelow ? <BottomFade color={surface} /> : null}
    </View>
  );
}

const FADE_SLICES = 8;

// React Native Web 0.21 has no experimental_backgroundImage, so no single gradient style draws on both desktop and iPad.
function BottomFade({ color }: { color: string }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
      {Array.from({ length: FADE_SLICES }, (_, i) => (
        <View key={i} style={{ height: 3, backgroundColor: withAlpha(color, (0.9 * i) / (FADE_SLICES - 1)) ?? undefined }} />
      ))}
    </View>
  );
}

export function AttentionList({ colors, dashboard, workspaceId, compact, touch, onSurface1, onCopy, onOpenAttachment }: {
  colors: Colors;
  dashboard: Dashboard;
  workspaceId: string;
  compact: boolean;
  touch: boolean;
  onSurface1: boolean;
  onCopy(question: Question, letter: string): void;
  onOpenAttachment(attachment: Attachment, group: Attachment[]): void;
}) {
  const { messages: m } = useProgressLanguage();
  const [shownId, setShownId] = useState(() => shownQuestions.get(workspaceId));
  const now = Date.now();
  const open = dashboard.questions.open;
  const found = open.findIndex((question) => question.id === shownId);
  const index = found === -1 ? 0 : found;
  const question: Question | undefined = open[index];
  // The last question can be answered while the popover is open.
  if (!question && !dashboard.stuck.length) {
    return <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{m.nothingNeedsYou}</Text>;
  }
  const show = (target: Question) => {
    shownQuestions.set(workspaceId, target.id);
    setShownId(target.id);
  };
  const advancePast = (copied: Question) => shownQuestions.set(workspaceId, (open[index + 1] ?? copied).id);
  const step = { colors, touch, onSurface1, onPress: show };
  const stepping = open.length > 1;
  const position = m.questionPosition(open.length);
  return (
    <View style={{ gap: HEADER_GAP }}>
      {stepping ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17, fontVariant: ["tabular-nums"] }}>
            {position[0]}<Text style={{ color: colors.foreground, fontWeight: "600" }}>{index + 1}</Text>{position[1]}
          </Text>
          <View style={{ flexDirection: "row", gap: touch ? stepSlop * 2 : 4 }}>
            <StepButton {...step} icon="ChevronLeft" label={m.previousQuestion} target={open[index - 1]} />
            <StepButton {...step} icon="ChevronRight" label={m.nextQuestion} target={open[index + 1]} />
          </View>
        </View>
      ) : null}
      <List key={question?.id} compact={compact} surface={onSurface1 ? colors.surface1 : colors.surface0} maxHeight={stepping ? LIST_MAX_HEIGHT - stepSize(touch) - HEADER_GAP : LIST_MAX_HEIGHT}>
        {question ? (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 19, fontWeight: "600" }}>{question.id}</Text>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 19 }}>{question.question}</Text>
                <QuestionState colors={colors} question={question} />
              </View>
            </View>
            <QuestionDetail colors={colors} question={question} now={now} onSurface1={onSurface1} onOpenAttachment={onOpenAttachment} onCopy={(letter) => {
              advancePast(question);
              onCopy(question, letter);
            }} />
          </View>
        ) : null}
        {dashboard.stuck.length ? (
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name="OctagonAlert" size={12} color={colors.statusDanger} />
              <Text style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 17, fontWeight: "600" }}>{m.stuck}</Text>
            </View>
            {dashboard.stuck.map((item) => (
              <Text key={item.key} style={{ color: colors.foreground, fontSize: 12, lineHeight: 17 }}>
                {item.title}
                <Text style={{ color: colors.foregroundMuted }}>
                  {item.kind === "overdue" ? m.overdueAside : item.kind === "blocked" ? m.blockedAside(item.note) : ""}
                </Text>
              </Text>
            ))}
          </View>
        ) : null}
      </List>
    </View>
  );
}

const stepSize = (touch: boolean) => (touch ? 36 : 24);
const stepSlop = (TOUCH_TARGET - stepSize(true)) / 2;

function StepButton({ colors, touch, onSurface1, icon, label, target, onPress }: {
  colors: Colors;
  touch: boolean;
  onSurface1: boolean;
  icon: "ChevronLeft" | "ChevronRight";
  label: string;
  target: Question | undefined;
  onPress(target: Question): void;
}) {
  const button = onSurface1 ? { rest: colors.surface2, pressed: colors.surface1 } : { rest: colors.surface1, pressed: colors.surface2 };
  const size = stepSize(touch);
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !target }} disabled={!target}
      onPress={target ? () => onPress(target) : undefined} hitSlop={touch ? stepSlop : undefined}
      style={({ pressed }) => ({ width: size, height: size, alignItems: "center", justifyContent: "center", borderRadius: touch ? 8 : 4, opacity: target ? 1 : 0.35, ...raised(colors),
        backgroundColor: pressed ? button.pressed : button.rest })}>
      <Icon name={icon} size={touch ? 16 : 14} color={colors.foreground} />
    </PressScale>
  );
}
