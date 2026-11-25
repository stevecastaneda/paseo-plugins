import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { clientHarness } from "../../test-support/client-harness.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));

function sender(reply: () => unknown) {
  let messages: unknown;
  const toasts: string[] = [];
  let requests = 0;
  const h = clientHarness(directory, {
    react: { ...React, useContext: () => ({ locale: "en", messages }) },
    "react-native": { Platform: { OS: "web" } },
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries() {} }) },
    "@getpaseo/plugin/client": {
      useRpc: () => async () => {
        requests++;
        return reply();
      },
    },
    "@getpaseo/plugin/client/ui": { useToast: () => ({ show: (text: string) => toasts.push(text), error: (text: string) => toasts.push(`error: ${text}`) }) },
  });
  messages = h.load("client/i18n.ts").messagesFor("en");
  const { send } = h.load("client/send-answer.ts").useSendAnswer({ workspaceId: "w", root: "/repo" });
  return { send, toasts, requests: () => requests };
}

const question = { id: "Q2", agentId: "a1", askedAt: "2026-11-25T12:00:00Z" };

test("the user hears what became of the answer", async () => {
  for (const [result, says] of [
    ["sent", "Sent your answer to Q2"],
    ["queued", "Queued your answer to Q2. It goes out when the agent's turn ends."],
    ["held", "error: Could not send your answer to Q2. Try again from the question."],
    ["gone", "error: The agent that asked Q2 is no longer here. Copy the answer instead."],
    ["closed", "error: Q2 is no longer open"],
  ]) {
    const s = sender(() => ({ result }));
    await s.send(question, { choice: "B" });
    assert.deepEqual(s.toasts, [says]);
  }
  const offline = sender(() => {
    throw new Error("offline");
  });
  await offline.send(question, { choice: "B" });
  assert.deepEqual(offline.toasts, ["error: Could not send Q2. Copy the answer instead."]);
});

test("a second press while the first is under way does nothing", async () => {
  const s = sender(() => ({ result: "sent" }));
  await Promise.all([s.send(question, { choice: "B" }), s.send(question, { choice: "B" })]);
  assert.equal(s.requests(), 1);
});
