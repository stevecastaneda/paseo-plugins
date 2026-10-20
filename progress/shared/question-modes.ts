// What an agent does when it asks the user a question, picked in Paseo's
// Settings. The command, the settings page, and the dashboard all read this
// table. No Paseo imports: the command's bundle includes this file.
export const QUESTION_MODES = ["stop", "work-around", "keep-building"] as const;
export type QuestionMode = (typeof QUESTION_MODES)[number];

// Also what a missing or damaged mirror means.
export const DEFAULT_QUESTION_MODE: QuestionMode = "work-around";

// An open question on the dashboard: the agent stopped all work, holds what the
// question affects, or builds its recommendation.
export type QuestionState = "stopped" | "waiting" | "building";

interface QuestionModeRules {
  label: string;
  hint: string;
  // What the agent does until the answer. `question ask` prints it after "Mode: <label>."
  askRule(question: { recommend: string; big: boolean }): string;
  state(big: boolean): QuestionState;
}

const HOLD = "Build no option before the answer, not even your recommendation. Work on everything the question doesn't affect. If nothing else is left, end your turn, tell the user in chat which questions you're waiting on, and leave the run open.";

export const QUESTION_MODE_RULES: Record<QuestionMode, QuestionModeRules> = {
  stop: {
    label: "Stop",
    hint: "Agents stop all work when they ask, until you answer.",
    askRule: () => "Ask any other questions you already have, then stop all work and resume only after an answer. End your turn now, tell the user in chat which questions you're waiting on, and leave the run open.",
    state: () => "stopped",
  },
  "work-around": {
    label: "Work around",
    hint: "Agents hold what your answer affects and keep working on the rest.",
    askRule: () => HOLD,
    state: () => "waiting",
  },
  "keep-building": {
    label: "Keep building",
    hint: "Agents build their recommended option while you decide, and change course if you pick another. Big questions still wait.",
    askRule: ({ recommend, big }) => big
      ? `This question is big, so hold it like Work around. ${HOLD}`
      : `Build ${recommend} now and keep working. If the user picks another option, undo the work built on ${recommend} and build their choice first. If the rest of the work is done while it's still open, leave it open and tell the user in chat; don't withdraw it.`,
    state: (big) => (big ? "waiting" : "building"),
  },
};
