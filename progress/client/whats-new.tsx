import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Text, View } from "react-native";
import { dismissWhatsNew, getWhatsNew, type WhatsNew, type WhatsNewNote } from "../shared/rpc";
import { spans } from "../shared/write-up";
import { PressScale, Presence } from "./motion";
import { raised } from "./surfaces";
import { BlockView, Spans } from "./write-up";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];

// Once after an update: this version's headline, with its full notes a press
// away. Closing either hides both for this version.
export function WhatsNewBanner({ colors, host }: { colors: Colors; host: PluginWorkspacePanelProps["host"] }) {
  const fetchWhatsNew = useRpc(getWhatsNew);
  const dismiss = useRpc(dismissWhatsNew);
  const queryClient = useQueryClient();
  const queryKey = ["progress", "whats-new", host.id];
  const query = useQuery({ queryKey, queryFn: () => fetchWhatsNew({}), staleTime: Infinity });
  const whatsNew = query.data ?? null;
  // Paseo's Modal keeps drawing its content while it fades out, so the notes outlive the dismissal.
  const [shown, setShown] = useState<WhatsNew | null>(null);
  const [open, setOpen] = useState(false);
  const close = (version: string) => {
    queryClient.setQueryData(queryKey, null);
    dismiss({ version }).catch(() => queryClient.invalidateQueries({ queryKey }));
  };
  const closeDialog = () => {
    if (!shown) return;
    setOpen(false);
    close(shown.version);
  };

  return (
    <>
      <Presence show={Boolean(whatsNew)}>{whatsNew ? (
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, margin: 12, marginBottom: 0, padding: 8, borderRadius: 12, ...raised(colors), backgroundColor: colors.surface1 }}>
          <View style={{ alignSelf: "flex-start", height: 17, justifyContent: "center" }}><Icon name="Gift" size={14} color={colors.foregroundMuted} /></View>
          <Text selectable style={{ flex: 1, minWidth: 200, color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
            <Text style={{ color: colors.foreground, fontWeight: "500" }}>New in {whatsNew.version}:</Text> {whatsNew.headline}
          </Text>
          {/* 8px keeps the close button's 6px hit slop off the button beside it. */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <PressScale accessibilityRole="button" onPress={() => { setShown(whatsNew); setOpen(true); }}
              style={({ pressed, hovered }) => ({ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, backgroundColor: colors.accent, opacity: pressed ? 0.7 : hovered ? 0.85 : 1 })}>
              <Text style={{ color: colors.accentForeground, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>See what's new</Text>
            </PressScale>
            <PressScale accessibilityRole="button" accessibilityLabel="Dismiss what's new" hitSlop={6} onPress={() => close(whatsNew.version)}
              style={({ pressed, hovered }) => ({ padding: 5, borderRadius: 4, backgroundColor: pressed ? colors.border : hovered ? colors.surface2 : "transparent" })}>
              <Icon name="X" size={16} color={colors.foregroundMuted} />
            </PressScale>
          </View>
        </View>
      ) : null}</Presence>
      <Modal title={shown ? `What's new in Progress ${shown.version}` : ""} icon={<Icon name="Gift" size={16} color={colors.foregroundMuted} />}
        open={open} onOpenChange={(next) => { if (!next) closeDialog(); }}>
        <Modal.Content>
          {shown ? <Notes colors={colors} notes={shown.notes} /> : null}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 8 }}>
            <PressScale accessibilityRole="button" onPress={closeDialog}
              style={({ pressed, hovered }) => ({ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.accent, opacity: pressed ? 0.7 : hovered ? 0.85 : 1 })}>
              <Text style={{ color: colors.accentForeground, fontSize: 12, lineHeight: 16, fontWeight: "600" }}>Got it</Text>
            </PressScale>
          </View>
        </Modal.Content>
      </Modal>
    </>
  );
}

// Titled notes read as a short list of headings with their details; a changelog
// written without titles stays a bulleted list.
function Notes({ colors, notes }: { colors: Colors; notes: WhatsNewNote[] }) {
  if (!notes.some((note) => note.title)) {
    return <View style={{ gap: 12 }}>{notes.map((note, index) => (
      <BlockView key={index} colors={colors} block={{ kind: "item", marker: "•", depth: 0, spans: spans(note.body) }} first={index === 0} />
    ))}</View>;
  }
  return (
    <View style={{ gap: 20 }}>
      {notes.map((note, index) => (
        <View key={index} style={{ gap: 4 }}>
          {note.title ? <Text accessibilityRole="header" selectable style={{ color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: "600" }}>{note.title}</Text> : null}
          {note.body ? (
            <Text selectable style={{ color: note.title ? colors.foregroundMuted : colors.foreground, fontSize: 13, lineHeight: 19 }}>
              <Spans colors={colors} spans={spans(note.body)} />
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
