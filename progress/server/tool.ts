import type { AgentToolContext, AgentToolDefinition, AgentToolResult, PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import * as sdk from "@getpaseo/plugin/server";
import { z } from "zod";
import { DELIVERABLE_KINDS, ticketStatusSchema } from "../shared/events.ts";
import type { ToolsState } from "../shared/rpc.ts";
import { PROGRESS_TOOL_NAMES, type ProgressToolName } from "../shared/tools.ts";
import { commandSummary, runCli } from "./cli.ts";

// Paseo supplies this SDK at runtime. Paseo 0.13's has no defineAgentTool and
// can't give agents plugin tools; reading the name calls nothing, so it's safe there.
export const agentToolsSupported = "defineAgentTool" in sdk;

// Importing defineAgentTool would stop Progress loading on Paseo 0.13. This
// mirrors its typing; Paseo validates the input before execute.
type Tool = Omit<AgentToolDefinition, "name">;

function agentTool<Input extends z.ZodType>(
  tool: Omit<Tool, "input" | "execute"> & {
    input: Input;
    execute(input: z.output<Input>, context: AgentToolContext): Promise<AgentToolResult>;
  },
): Tool {
  return { ...tool, execute: (input, context) => tool.execute(input as z.output<Input>, context) };
}

async function run(args: string[], { agent }: AgentToolContext): Promise<AgentToolResult> {
  const lines: string[] = [];
  const code = await runCli(args, { cwd: agent.cwd, agentId: agent.id, out: (line) => lines.push(line) });
  return { text: lines.join("\n"), isError: code !== 0 };
}

type Flags = Record<string, string | number | string[] | undefined>;

// Flags go as --name=value so a value starting with "-" stays a value, and the
// positionals follow "--" so a title starting with "-" isn't read as a flag.
function commandArgs(command: string, positionals: string[], flags: Flags = {}): string[] {
  const options = Object.entries(flags).flatMap(([name, value]) => (value === undefined ? [] : [value].flat().map((entry) => `--${name}=${entry}`)));
  return [...command.split(" "), ...options, "--", ...positionals];
}

// The command's --help summary, with its flags renamed to this tool's fields.
const FIELD_FOR_FLAG: Record<string, string> = { estimate: "estimateMinutes", option: "options", file: "files" };
function toolSummary(command: string): string {
  return commandSummary(command).replace(
    /--([a-z]+(?:-[a-z]+)*)/g,
    (_, flag: string) => FIELD_FOR_FLAG[flag] ?? flag.replace(/-([a-z])/g, (_m, letter: string) => letter.toUpperCase()),
  );
}

function commandTool<Input extends z.ZodType>(title: string, command: string, input: Input, args: (input: z.output<Input>) => string[], extra = "") {
  return agentTool({
    title: `Progress: ${title}`,
    description: `Progress dashboard for this worktree in Paseo. ${toolSummary(command)}${extra}`,
    input,
    execute: (value, context) => run(args(value), context),
  });
}

const ticketId = (what: string) => z.string().describe(`${what}, like T03`);
const estimate = z.number().int().describe("Whole minutes, like 90");
const source = z.string().describe("Spec file path or http(s) link where the ticket is written up");

// Keyed by name, so the compiler holds this to the shared list.
const tools: Record<ProgressToolName, Tool> = {
  progress_show: commandTool("Show", "show", z.object({}), () => ["show"]),
  progress_start: commandTool(
    "Start run",
    "start",
    z.object({
      title: z.string(),
      subtitle: z.string().optional(),
      itemLabel: z.string().optional().describe('What to call each item instead of "Ticket", like Step'),
    }),
    ({ title, subtitle, itemLabel }) => commandArgs("start", [title], { subtitle, "item-label": itemLabel }),
  ),
  progress_ticket_add: commandTool(
    "Add ticket",
    "ticket add",
    z.object({
      title: z.string().describe('Like "Ticket 01: Export button"'),
      estimateMinutes: estimate,
      status: ticketStatusSchema.optional(),
      waitsFor: ticketId("A ticket this one can't start before").optional(),
      source: source.optional(),
    }),
    ({ title, estimateMinutes, status, waitsFor, source }) =>
      commandArgs("ticket add", [title], { estimate: estimateMinutes, status, "waits-for": waitsFor, source }),
  ),
  progress_ticket_update: commandTool(
    "Update ticket",
    "ticket update",
    z.object({
      id: ticketId("The ticket"),
      status: ticketStatusSchema.optional(),
      stage: z.string().optional().describe('The step in progress, like Build or Fixes; "" clears it'),
      title: z.string().optional(),
      estimateMinutes: estimate.optional(),
      note: z.string().optional(),
      waitsFor: z.string().optional().describe('A ticket this one can\'t start before, like T02; "" clears it'),
      source: z.string().optional().describe('Spec file path or http(s) link where the ticket is written up; "" clears it'),
    }),
    ({ id, status, stage, title, estimateMinutes, note, waitsFor, source }) =>
      commandArgs("ticket update", [id], { status, stage, title, estimate: estimateMinutes, note, "waits-for": waitsFor, source }),
  ),
  progress_question_ask: commandTool(
    "Ask question",
    "question ask",
    z.object({
      title: z.string().describe("A short title"),
      question: z.string(),
      options: z.array(
        z.object({
          letter: z.string().describe("A, B, C, ..."),
          label: z.string(),
          consequence: z.string().describe("What picking it means for the user"),
        }),
      ),
      recommend: z.string().describe("The option letter you would pick"),
      big: z.string().optional().describe("Only for a big question: which test it meets, in a few plain words"),
      background: z.string().optional(),
      files: z
        .array(
          z.object({
            target: z.string().describe("A file path or http(s) link, like a screenshot"),
            label: z.string().optional(),
          }),
        )
        .optional(),
      ticket: ticketId("The ticket it's about").optional(),
    }),
    ({ title, question, options, recommend, big, background, files, ticket }) =>
      commandArgs("question ask", [title, question], {
        option: options.map(({ letter, label, consequence }) => `${letter}=${label} | ${consequence}`),
        recommend,
        big,
        background,
        file: files?.map(({ target, label }) => (label ? `${target}=${label}` : target)),
        ticket,
      }),
  ),
  progress_question_answer: commandTool(
    "Record answer",
    "question answer",
    z.object({
      id: z.string().describe("The question, like Q2"),
      choice: z.string().describe("An option letter, or the user's own short answer"),
      words: z.string().optional().describe("What the user said"),
    }),
    ({ id, choice, words }) => commandArgs("question answer", [id, choice], { words }),
  ),
  progress_deliverable_add: commandTool(
    "Add deliverable",
    "deliverable add",
    z.object({
      title: z.string(),
      target: z.string().describe("A file or folder path, or an http(s) link"),
      ticket: ticketId("The ticket it belongs to").optional(),
      kind: z.enum(DELIVERABLE_KINDS).optional(),
    }),
    ({ title, target, ticket, kind }) => commandArgs("deliverable add", [title, target], { ticket, kind }),
  ),
  progress_activity_add: commandTool(
    "Log activity",
    "activity add",
    z.object({ text: z.string(), ticket: ticketId("The ticket it's about").optional() }),
    ({ text, ticket }) => commandArgs("activity add", [text], { ticket }),
  ),
  progress_ticker: commandTool(
    "Set ticker",
    "ticker set",
    z.object({ text: z.string() }),
    ({ text }) => (text.trim() ? commandArgs("ticker set", [text]) : commandArgs("ticker clear", [])),
    ' Pass "" to hide it.',
  ),
  progress_finish: commandTool("Finish run", "finish", z.object({ outcome: z.string().describe("One line") }), ({ outcome }) =>
    commandArgs("finish", [outcome]),
  ),
  paseo_progress: agentTool({
    title: "Progress",
    description: [
      "Record progress for this worktree on the Progress panel in Paseo. Works like the paseo-progress command:",
      'pass its arguments as a list, like ["ticket", "add", "Fix login", "--estimate", "30"].',
      'Pass ["--help"] to list the commands, or add "--help" after any command for its options.',
    ].join(" "),
    input: z.object({ args: z.array(z.string()).min(1).describe("Arguments for paseo-progress, one per item") }),
    execute: ({ args }, context) => run(args, context),
  }),
};

export const progressTools: AgentToolDefinition[] = PROGRESS_TOOL_NAMES.map((name) => ({ name, ...tools[name] }));

export function attachProgressTools(server: PluginServerContext): void {
  server.before("agent.session_open", ({ request }) => {
    // Paseo 0.13 has no tools list and fails the session open if a plugin adds one.
    if (!Array.isArray(request.tools)) return;
    return { ...request, tools: [...request.tools, ...progressTools] };
  });
}

// Tools reach agents only while the host's "Enable Paseo tools" setting is on,
// which needs Paseo's tools (mcp.enabled) on as well.
export async function toolsState(supported: boolean, paseo: PluginHandlerContext["paseo"]): Promise<ToolsState> {
  if (!supported) return "unsupported";
  const { config } = await paseo.config.get();
  return config.mcp.enabled !== false && config.mcp.injectIntoAgents ? "on" : "off";
}

export async function handleToolsStatus(_input: unknown, { paseo }: PluginHandlerContext): Promise<{ state: ToolsState }> {
  return { state: await toolsState(agentToolsSupported, paseo) };
}
