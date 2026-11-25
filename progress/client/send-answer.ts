import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { useQueryClient } from "@tanstack/react-query";
import type { Answer } from "../shared/answers";
import type { Question } from "../shared/dashboard";
import { cancelAnswer, sendAnswer } from "../shared/rpc";
import { useProgressLanguage } from "./language";

// Presses under way, so a second press can't send twice.
const sending = new Set<string>();

// Gives answers to the agent that asked, through the plugin's server, which
// holds them while the agent works.
export function useSendAnswer({ workspaceId, root }: { workspaceId: string; root: string }) {
  const { messages: m } = useProgressLanguage();
  const toast = useToast();
  const requestSend = useRpc(sendAnswer);
  const requestCancel = useRpc(cancelAnswer);
  const queryClient = useQueryClient();
  const target = (question: Question) => ({ workspaceId, workspaceDirectory: root, questionId: question.id, askedAt: question.askedAt });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["progress", "dashboard"] });
  return {
    // Whether the server has the answer: sent, waiting, or held for another try.
    async send(question: Question, answer: Answer, now = false): Promise<boolean> {
      const key = `${workspaceId}:${question.askedAt}:${question.id}`;
      if (sending.has(key)) return false;
      sending.add(key);
      try {
        const { result } = await requestSend({ ...target(question), answer, now });
        refresh();
        if (result === "sent") toast.show(m.sentAnswer(question.id), { variant: "success" });
        else if (result === "queued") toast.show(m.queuedAnswer(question.id), { variant: "success" });
        else if (result === "gone") toast.error(m.sendAgentGone(question.id));
        else if (result === "closed") toast.error(m.sendClosed(question.id));
        else toast.error(m.heldAnswer(question.id));
        return result !== "gone" && result !== "closed";
      } catch {
        toast.error(m.sendFailure(question.id));
        return false;
      } finally {
        sending.delete(key);
      }
    },
    async cancel(question: Question): Promise<void> {
      try {
        await requestCancel(target(question));
      } catch {
        toast.error(m.cancelFailure(question.id));
      }
      refresh();
    },
  };
}
