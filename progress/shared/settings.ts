import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { QUESTION_MODES } from "./events.ts";

export const questionSettings = defineSettings({
  id: "questions",
  scope: "host",
  version: 1,
  schema: z.object({ mode: z.enum(QUESTION_MODES).default("stop") }),
});
