import type { Dashboard } from "./dashboard.ts";

export interface Attention {
  questions: number;
  stuck: number;
}

export function attentionOf(dashboard: Dashboard): Attention {
  return { questions: dashboard.questions.open.length, stuck: dashboard.stuck.length };
}

// "3 questions · 1 stuck", or null when nothing needs the user.
export function pillLabel({ questions, stuck }: Attention): string | null {
  const parts = [];
  if (questions) parts.push(`${questions} ${questions === 1 ? "question" : "questions"}`);
  if (stuck) parts.push(`${stuck} stuck`);
  return parts.length ? parts.join(" · ") : null;
}
