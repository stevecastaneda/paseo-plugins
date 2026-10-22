import { type PluginClientContext, type PluginScreenProps, useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { previewDeliverable } from "../shared/rpc";
import { errorText } from "./errors";
import { ProgressLanguageProvider, useProgressLanguage } from "./language";
import { type PageParams, setPageOpener } from "./page-opener";

const PAGE_SCREEN_ID = "page";

export function addPageScreen(client: PluginClientContext) {
  setPageOpener((params) => client.openScreen({ screenId: PAGE_SCREEN_ID, params }));
  const stop = client.addScreen({
    id: PAGE_SCREEN_ID,
    title: (params) => params.title ?? "",
    Component: (props) => <ProgressLanguageProvider><PageScreen {...props} /></ProgressLanguageProvider>,
  });
  return () => {
    setPageOpener(null);
    void stop();
  };
}

// Keys pressed inside the page go to the page, so it tells Progress about
// Escape itself, unless one of its own handlers has used the key.
const ESCAPE = "progress:page-escape";
const ESCAPE_SCRIPT = `<script>addEventListener("keydown",function(e){if(e.key==="Escape"&&!e.defaultPrevented)parent.postMessage("${ESCAPE}","*")})</script>`;

// The plugin compiles without the DOM's types; these are the browser APIs used here.
type KeyEvent = { key: string; defaultPrevented: boolean };
type FrameMessage = { data: unknown; source: unknown };
type Frame = { contentWindow: unknown; getClientRects(): { length: number } };
const browser = globalThis as unknown as {
  addEventListener(type: "keydown", listener: (event: KeyEvent) => void): void;
  addEventListener(type: "message", listener: (event: FrameMessage) => void): void;
  removeEventListener(type: "keydown" | "message", listener: (event: never) => void): void;
};

// Escape leaves the page, like the Close button in Paseo's header.
// Paseo can keep a screen mounted, hidden, after leaving it, so Escape only
// counts while the page is on screen.
function useEscapeToClose(frame: React.RefObject<Frame | null>, close: (() => void) | undefined) {
  useEffect(() => {
    if (!close || typeof browser.addEventListener !== "function") return;
    const onKey = (event: KeyEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && frame.current?.getClientRects().length) close();
    };
    const onMessage = (event: FrameMessage) => {
      if (event.data === ESCAPE && event.source === frame.current?.contentWindow) close();
    };
    browser.addEventListener("keydown", onKey);
    browser.addEventListener("message", onMessage);
    return () => {
      browser.removeEventListener("keydown", onKey);
      browser.removeEventListener("message", onMessage);
    };
  }, [close]);
}

// An HTML deliverable across the whole screen, the width it was written for.
function PageScreen({ params, theme: { colors }, navigation }: PluginScreenProps) {
  const { messages: m } = useProgressLanguage();
  const fetchPreview = useRpc(previewDeliverable);
  const { workspaceId, workspaceDirectory, ref } = params as PageParams;
  const page = useQuery({
    queryKey: ["progress", "page", workspaceId, ref],
    queryFn: () => fetchPreview({ workspaceId, workspaceDirectory, ref }),
  });
  // The page stays hidden on Paseo's background until it has drawn, so opening it
  // doesn't flash an empty white frame first.
  const [shownHtml, setShownHtml] = useState<string | null>(null);
  const frame = useRef<Frame | null>(null);
  useEscapeToClose(frame, navigation ? () => navigation.openWorkspace({ workspaceId }) : undefined);
  if (page.data?.kind === "html") {
    const html = page.data.html + ESCAPE_SCRIPT;
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface0 }}>
        {/* `allow-scripts` alone, as in Paseo's own HTML preview: the page runs its scripts
            (and loads them from the web, so no CSP) in an opaque origin that can't reach
            Paseo's DOM or storage, navigate the app, open windows or submit forms. */}
        <iframe ref={frame as never} srcDoc={html} sandbox="allow-scripts" referrerPolicy="no-referrer" title={params.title} onLoad={() => setShownHtml(html)}
          style={{ flex: 1, width: "100%", height: "100%", display: "block", border: "none", backgroundColor: "white",
            opacity: shownHtml === html ? 1 : 0, transition: "opacity 150ms ease-out" }} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      {page.error ? (
        <Text accessibilityRole="alert" selectable style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 18 }}>
          {m.previewError(errorText(page.error, m.unknownError))}
        </Text>
      ) : <ActivityIndicator color={colors.foregroundMuted} accessibilityLabel={m.loadingPreview} />}
    </View>
  );
}
