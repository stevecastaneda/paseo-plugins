import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import React, { useEffect, useRef, useState } from "react";
import type { Dashboard, Question } from "../shared/dashboard";
import { type Attachment, attachmentIcon, useAttachmentOpener } from "./attachments";
import { NarrowProvider } from "./narrow";
import { BackButton, PreviewContent, previewable } from "./preview";
import { QuestionView, useCopy } from "./questions";
import { TicketStoryView } from "./ticket-dialog";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type AttachmentContext = { workspaceId: string; workspaceDirectory: string; navigation?: PluginWorkspacePanelProps["navigation"] };

// What the dialog is showing. A preview keeps the files beside it for Previous and Next.
export type Step =
  | { kind: "ticket"; id: string }
  | { kind: "question"; id: string }
  | { kind: "preview"; attachment: Attachment; group: Attachment[] };

// One dialog for a ticket, a question or a preview, and everything opened from
// it. Paseo gives each dialog its own backdrop, so opening a second one darkens
// the screen while the first fades out; instead the content changes in place,
// and Back returns to the step before.
export function StackedDialog({ colors, root, onClose, questions = [], dashboard, now, live = true, context }: {
  colors: Colors;
  // The step it opens on; null closes it.
  root: Step | null;
  onClose(): void;
  // Needed only when it opens on a ticket or a question.
  questions?: Question[];
  // Needed only when it opens on a ticket.
  dashboard?: Dashboard;
  now: number;
  live?: boolean;
  context: AttachmentContext;
}) {
  // Every step from the root, oldest first. A new root starts over; closing
  // keeps them, so the last one stays drawn while the dialog fades out.
  const [steps, setSteps] = useState<Step[]>(root ? [root] : []);
  const rootKey = root ? stepKey(root) : null;
  const [stepsFor, setStepsFor] = useState(rootKey);
  if (stepsFor !== rootKey) {
    setStepsFor(rootKey);
    if (root) setSteps([root]);
  }
  // The list an attachment was opened from, so its preview can step through the rest.
  const group = useRef<Attachment[]>([]);
  const push = (step: Step) => setSteps((current) => [...current, step]);
  const replaceTop = (step: Step) => setSteps((current) => [...current.slice(0, -1), step]);
  const opener = useAttachmentOpener({ ...context, onPreview: (attachment) => push({ kind: "preview", attachment, group: previewable(group.current) }) });
  const openAttachment = (attachment: Attachment, from: Attachment[]) => {
    group.current = from;
    // A link opens elsewhere in Paseo; close first so it isn't left behind the dialog.
    if (attachment.url) onClose();
    void opener.open(attachment);
  };
  // Opens the agent's chat in its workspace, with the dialog out of the way.
  const openAgent = context.navigation ? (agentId: string) => {
    onClose();
    context.navigation!.openAgent({ agentId });
  } : undefined;
  const copy = useCopy();
  const top = steps.at(-1);
  const back = steps.length > 1 ? () => setSteps((current) => current.slice(0, -1)) : undefined;

  const ticket = top?.kind === "ticket" ? dashboard?.tickets.find((candidate) => candidate.id === top.id) : undefined;
  const question = top?.kind === "question" ? questions.find((candidate) => candidate.id === top.id) : undefined;
  const preview = top?.kind === "preview" ? top : undefined;
  // The ticket or question it opened on went away (answered elsewhere, or a new run): close rather than show a blank dialog.
  const rootMissing = root !== null && (root.kind === "ticket" ? !dashboard?.tickets.some((candidate) => candidate.id === root.id)
    : root.kind === "question" ? !questions.some((candidate) => candidate.id === root.id) : false);
  useEffect(() => {
    if (rootMissing) onClose();
  }, [rootMissing]);
  const [previewLong, setPreviewLong] = useState(false);
  const title = ticket ? `${ticket.id} · ${ticket.title}` : question ? `${question.id} · ${question.title}` : preview ? preview.attachment.title : "";
  const icon = ticket ? "ListChecks" : question ? "MessageCircleQuestion" : preview ? attachmentIcon(preview.attachment) : "ListChecks";

  return (
    <Modal title={title} icon={<Icon name={icon} size={16} color={colors.foregroundMuted} />}
      open={Boolean(root)} onOpenChange={(next) => { if (!next) onClose(); }}>
      {/* One Modal.Content for every step: replacing it would re-present the sheet on phones. */}
      <Modal.Content scrollable={!(preview && previewLong)}>
      {/* A dialog has room for clock times, however narrow the panel that opened it. */}
      <NarrowProvider value={false}>
      {preview ? (
        <PreviewContent colors={colors} attachment={preview.attachment} workspaceId={context.workspaceId} workspaceDirectory={context.workspaceDirectory}
          onOpenOnHost={() => { onClose(); void opener.openOnHost(preview.attachment); }} onBack={back}
          gallery={{ items: preview.group, onSelect: (attachment) => replaceTop({ ...preview, attachment }) }} onLong={setPreviewLong}
          onOpenEntry={openAttachment} />
      ) : (
        <>
          {ticket && dashboard ? (
            <TicketStoryView colors={colors} dashboard={dashboard} ticket={ticket} now={now} live={live} context={context} onOpenAgent={openAgent}
              onOpenAttachment={openAttachment} onOpenQuestion={(id) => push({ kind: "question", id })} />
          ) : null}
          {question ? (
            <QuestionView colors={colors} question={question} now={now}
              onCopy={(letter) => { void copy(question, letter); onClose(); }}
              onOpenAttachment={openAttachment}>
              {back ? <BackButton colors={colors} onPress={back} /> : null}
            </QuestionView>
          ) : null}
        </>
      )}
      </NarrowProvider>
      </Modal.Content>
    </Modal>
  );
}

function stepKey(step: Step): string {
  return step.kind === "preview" ? `preview:${step.attachment.ref}` : `${step.kind}:${step.id}`;
}

