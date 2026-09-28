import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import React, { useRef, useState } from "react";
import type { Dashboard, Question } from "../shared/dashboard";
import { type Attachment, attachmentIcon, useAttachmentOpener } from "./attachments";
import { useLastPresent } from "./motion";
import { BackButton, PreviewBody, previewable } from "./preview";
import { QuestionView, useCopy } from "./questions";
import { TicketStoryView } from "./ticket-dialog";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type AttachmentContext = { workspaceId: string; workspaceDirectory: string; navigation?: PluginWorkspacePanelProps["navigation"] };

// What the dialog is showing. A preview keeps the files beside it for Previous and Next.
export type Step =
  | { kind: "ticket"; id: string }
  | { kind: "question"; id: string }
  | { kind: "preview"; attachment: Attachment; group: Attachment[] };

// One dialog for a ticket or a question and everything opened from it. Paseo
// gives each dialog its own backdrop, so opening a second one darkens the screen
// while the first fades out; instead the content changes in place, and Back
// returns to the step before.
export function StackedDialog({ colors, root, onClose, questions, dashboard, now, live = true, context }: {
  colors: Colors;
  // The ticket or question it opens on; null closes it.
  root: Step | null;
  onClose(): void;
  questions: Question[];
  // Needed only when it opens on a ticket.
  dashboard?: Dashboard;
  now: number;
  live?: boolean;
  context: AttachmentContext;
}) {
  // What was opened on top of the root, oldest first. Cleared when a new root opens.
  const [trail, setTrail] = useState<Step[]>([]);
  const rootKey = root && root.kind !== "preview" ? `${root.kind}:${root.id}` : null;
  const [trailFor, setTrailFor] = useState(rootKey);
  if (trailFor !== rootKey) {
    setTrailFor(rootKey);
    if (rootKey) setTrail([]);
  }
  // The list an attachment was opened from, so its preview can step through the rest.
  const group = useRef<Attachment[]>([]);
  const push = (step: Step) => setTrail((current) => [...current, step]);
  const replaceTop = (step: Step) => setTrail((current) => [...current.slice(0, -1), step]);
  const opener = useAttachmentOpener({ ...context, onPreview: (attachment) => push({ kind: "preview", attachment, group: previewable(group.current) }) });
  const openAttachment = (attachment: Attachment, from: Attachment[]) => {
    group.current = from;
    void opener.open(attachment);
  };
  const copy = useCopy();
  const steps: Step[] = root ? [root, ...trail] : [];
  // Keep drawing the last step while the dialog fades out.
  const shown = useLastPresent(steps.length ? { top: steps[steps.length - 1], previous: steps[steps.length - 2] } : null);
  const back = shown?.previous ? { label: `Back to ${stepName(shown.previous)}`, onPress: () => setTrail((current) => current.slice(0, -1)) } : null;

  const top = shown?.top;
  const ticket = top?.kind === "ticket" ? dashboard?.tickets.find((candidate) => candidate.id === top.id) : undefined;
  const question = top?.kind === "question" ? questions.find((candidate) => candidate.id === top.id) : undefined;
  const preview = top?.kind === "preview" ? top : undefined;
  const title = ticket ? `${ticket.id} · ${ticket.title}` : question ? `${question.id} · ${question.title}` : preview ? preview.attachment.title : "";
  const icon = ticket ? "ListChecks" : question ? "MessageCircleQuestion" : preview ? attachmentIcon(preview.attachment) : "ListChecks";

  return (
    <Modal title={title} icon={<Icon name={icon} size={16} color={colors.foregroundMuted} />}
      open={Boolean(root)} onOpenChange={(next) => { if (!next) onClose(); }}>
      {preview ? (
        <PreviewBody colors={colors} attachment={preview.attachment} workspaceId={context.workspaceId} workspaceDirectory={context.workspaceDirectory}
          onOpenOnHost={() => { onClose(); void opener.openOnHost(preview.attachment); }} backLabel={back?.label} onBack={back?.onPress}
          gallery={{ items: preview.group, onSelect: (attachment) => replaceTop({ ...preview, attachment }) }} />
      ) : (
        <Modal.Content>
          {ticket && dashboard ? (
            <TicketStoryView colors={colors} dashboard={dashboard} ticket={ticket} now={now} live={live}
              onOpenAttachment={openAttachment} onOpenQuestion={(id) => push({ kind: "question", id })} />
          ) : null}
          {question ? (
            <QuestionView colors={colors} question={question} now={now}
              onCopy={(letter) => { void copy(question, letter); onClose(); }}
              onOpenAttachment={openAttachment}>
              {back ? <BackButton colors={colors} label={back.label} onPress={back.onPress} /> : null}
            </QuestionView>
          ) : null}
        </Modal.Content>
      )}
    </Modal>
  );
}

function stepName(step: Step): string {
  return step.kind === "preview" ? step.attachment.title : step.id;
}
