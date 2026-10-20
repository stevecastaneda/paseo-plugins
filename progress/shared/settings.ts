import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { DEFAULT_QUESTION_MODE, QUESTION_MODES } from "./question-modes.ts";

export const questionSettings = defineSettings({
  id: "questions",
  scope: "host",
  version: 1,
  schema: z.object({ mode: z.enum(QUESTION_MODES).default(DEFAULT_QUESTION_MODE) }),
});
