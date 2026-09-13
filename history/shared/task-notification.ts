export interface TaskNotification {
  taskId: string;
  toolUseId?: string;
  outputFile?: string;
  status: string;
  summary: string;
  note?: string;
  result?: string;
  tokens?: number;
  toolUses?: number;
  durationMs?: number;
}

// Recognize only a complete, standalone harness envelope. Unknown/malformed
// fields fall back to the original message instead of silently discarding data.
function fields(source: string, allowed: Set<string>): Record<string, string> | null {
  const output: Record<string, string> = {};
  let remaining = source.trim();
  while (remaining) {
    const field = /^<([a-z_-]+)>([\s\S]*?)<\/\1>/.exec(remaining);
    if (!field || !allowed.has(field[1]!) || Object.hasOwn(output, field[1]!)) return null;
    output[field[1]!] = field[2]!;
    remaining = remaining.slice(field[0].length).trim();
  }
  return output;
}

function number(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parseTaskNotification(source: string): TaskNotification | null {
  const envelope = /^\s*<task-notification>([\s\S]*)<\/task-notification>\s*$/.exec(source);
  if (!envelope) return null;
  const value = fields(envelope[1]!, new Set(["task-id", "tool-use-id", "output-file", "status", "summary", "note", "result", "usage"]));
  if (!value || !value["task-id"]?.trim() || !value.status?.trim() || !value.summary?.trim()) return null;
  const usage = value.usage === undefined ? {} : fields(value.usage, new Set(["subagent_tokens", "tool_uses", "duration_ms"]));
  if (!usage) return null;
  return {
    taskId: value["task-id"].trim(), toolUseId: value["tool-use-id"]?.trim(), outputFile: value["output-file"]?.trim(),
    status: value.status.trim(), summary: value.summary.trim(), note: value.note?.trim(), result: value.result,
    tokens: number(usage.subagent_tokens), toolUses: number(usage.tool_uses), durationMs: number(usage.duration_ms),
  };
}

export function notificationUsage(notification: TaskNotification): string {
  const parts: string[] = [];
  if (notification.tokens !== undefined) parts.push(`${notification.tokens.toLocaleString()} tokens`);
  if (notification.toolUses !== undefined) parts.push(`${notification.toolUses.toLocaleString()} tool uses`);
  if (notification.durationMs !== undefined) {
    const seconds = Math.round(notification.durationMs / 1000);
    parts.push(seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`);
  }
  return parts.join(" · ");
}
