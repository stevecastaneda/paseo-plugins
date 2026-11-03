import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { ProgressPanel } from "./client/panel";
import { contributePills, progressPanel } from "./client/pills";
import { QuestionSettings } from "./client/settings";
import { ProgressLanguageProvider } from "./client/language";
import { addPageScreen } from "./client/page-screen";
import { PdfPanel } from "./client/pdf";
import { showsPdfs } from "./shared/attachments";
import { CHAT_ROW_KIND, CHAT_ROW_VERSION, chatRowSchema, transformChatRow } from "./client/chat-row";
import { ChatRowView } from "./client/chat-row-view";

const SETTINGS_ID = "settings";

export default function contribute(client: PluginClientContext) {
  const stopPills = contributePills(client);
  const panel = progressPanel();
  const stopPanel = client.addWorkspacePanel({
    id: panel.id,
    title: "Progress",
    icon: "ListChecks",
    locations: [panel.location],
    Component: (props) => <ProgressLanguageProvider><ProgressPanel {...props} openSettings={() => client.openSettings(SETTINGS_ID)} /></ProgressLanguageProvider>,
  });
  const stopCommand = client.addCommandCenterItem({
    id: "open-progress",
    title: "Open Progress",
    icon: "ListChecks",
    keywords: ["dashboard", "tickets", "status", "questions"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(panel.id, { location: panel.location });
    },
  });

  const stopPdf = showsPdfs(Platform.OS) ? client.addFilePanel({
    id: "pdf",
    title: "PDF",
    icon: "BookOpenText",
    files: { extensions: ["pdf"] },
    Component: (props) => <ProgressLanguageProvider><PdfPanel {...props} /></ProgressLanguageProvider>,
  }) : () => {};
  const stopPage = addPageScreen(client);
  const stopSettings = client.addSettingsScreen({
    id: SETTINGS_ID,
    title: "Settings",
    icon: "Settings",
    Component: (props) => <ProgressLanguageProvider><QuestionSettings {...props} /></ProgressLanguageProvider>,
  });
  const stopTransformer = client.addTimelineTransformer({ id: "tool-calls", query: { itemType: "tool_call" }, transform: transformChatRow });
  const stopRenderer = client.addTimelineRenderer({
    kind: CHAT_ROW_KIND,
    version: CHAT_ROW_VERSION,
    schema: chatRowSchema,
    Component: (props) => <ProgressLanguageProvider><ChatRowView {...props} /></ProgressLanguageProvider>,
  });

  return () => {
    void stopTransformer();
    void stopRenderer();
    stopPage();
    void stopPdf();
    void stopSettings();
    void stopPanel();
    void stopCommand();
    stopPills();
  };
}
