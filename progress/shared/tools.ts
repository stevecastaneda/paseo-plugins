// The tools Progress hands agents on Paseo 0.14 and later. The server defines
// one tool per name, and the chat draws Progress's own row for a call to any of them.
export const PROGRESS_TOOL_NAMES = [
  "progress_show",
  "progress_start",
  "progress_ticket_add",
  "progress_ticket_update",
  "progress_question_ask",
  "progress_question_answer",
  "progress_deliverable_add",
  "progress_activity_add",
  "progress_ticker",
  "progress_finish",
  "paseo_progress",
] as const;

export type ProgressToolName = (typeof PROGRESS_TOOL_NAMES)[number];

// Chats record a tool under the agent's own prefix: Claude Code's
// mcp__paseo__progress_ticket_add, or Codex's paseo.progress_ticket_add.
export function progressToolName(name: string): ProgressToolName | undefined {
  return PROGRESS_TOOL_NAMES.find((tool) => name === tool || name.endsWith(`__${tool}`) || name.endsWith(`.${tool}`));
}
