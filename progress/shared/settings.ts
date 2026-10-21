import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { DEFAULT_QUESTION_MODE, QUESTION_MODES } from "./question-modes.ts";

export const questionSettings = defineSettings({
  id: "questions",
  scope: "host",
  version: 1,
  schema: z.object({ mode: z.enum(QUESTION_MODES).default(DEFAULT_QUESTION_MODE) }),
});

export const LANGUAGE_PREFERENCES = ["system", "en", "zh-CN"] as const;
export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number];

export const displaySettings = defineSettings({
  id: "display",
  scope: "host",
  version: 1,
  schema: z.object({ language: z.enum(LANGUAGE_PREFERENCES).default("system") }),
});
