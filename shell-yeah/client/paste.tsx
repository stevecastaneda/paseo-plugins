import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/ui";
import React, { useState } from "react";
import { Platform, Text, View } from "react-native";
import { LIMITS } from "../shared/limits.ts";
import { makePalette, withAlpha, type ThemeColors } from "./palette.ts";
import { Button, codeSurface, mono } from "./ui.tsx";

// Paste for a phone, where the box that takes the keys is too small to press and hold. A phone
// browser reads the clipboard when the button is pressed. Paseo gives plugins no way to read
// the clipboard in its app, so there the button opens a box to press and hold in. The box hides
// what it holds, like the command's own password prompt.
export function PasteButton({ colors, onPaste }: { colors: ThemeColors; onPaste(text: string): void }) {
  const [open, setOpen] = useState(false);

  async function paste() {
    const clipboard = Platform.OS === "web" ? (globalThis as { navigator?: { clipboard?: { readText?(): Promise<string> } } }).navigator?.clipboard : undefined;
    if (!clipboard?.readText) return setOpen(true);
    try {
      onPaste(await clipboard.readText());
    } catch {
      setOpen(true);
    }
  }

  return (
    <>
      <Button icon="ClipboardPaste" label="Paste" tone="quiet" onPress={() => void paste()} compact colors={colors} accessibilityLabel="Paste into the command" />
      {open ? <PasteBox colors={colors} onClose={() => setOpen(false)} onPaste={onPaste} /> : null}
    </>
  );
}

function PasteBox({ colors, onClose, onPaste }: { colors: ThemeColors; onClose(): void; onPaste(text: string): void }) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const palette = makePalette(colors);
  const submit = () => {
    if (!text) return;
    onClose();
    onPaste(text);
  };
  return (
    <Modal title="Paste into the command" icon={<Icon name="ClipboardPaste" size={16} color={colors.foregroundMuted} />} open onOpenChange={(next) => { if (!next) onClose(); }}>
      <Modal.Content>
        <View style={{ gap: 12 }}>
          <View style={{ borderRadius: 6, backgroundColor: palette.well, borderWidth: 1, borderColor: focused ? colors.accent : withAlpha(colors.border, 0.6), paddingHorizontal: 12, paddingVertical: 8 }} {...codeSurface()}>
            <TextInput
              autoFocus
              value={text}
              onChangeText={setText}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onSubmitEditing={submit}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              maxLength={LIMITS.commandChars}
              placeholder="Press and hold, then tap Paste"
              placeholderTextColor={colors.foregroundMuted}
              accessibilityLabel="Text to paste into the command"
              // 16 px: iOS Safari zooms the page into a smaller box when it's tapped.
              style={{ height: 24, padding: 0, fontFamily: mono(), fontSize: 16, lineHeight: 24, color: colors.foreground, outlineWidth: 0 }}
            />
          </View>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>It goes in as if you typed it. Then press Return if the command asks for it.</Text>
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <Button icon="ClipboardPaste" label="Paste" tone="primary" onPress={submit} disabled={!text} compact colors={colors} accessibilityLabel="Paste into the command" />
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}
