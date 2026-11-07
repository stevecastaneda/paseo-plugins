// Reviews the plugin in the current directory against THREAT-MODEL.md with a
// reviewer that didn't write it, and fails when the review finds a release
// blocker. Runs as each plugin's `prepublishOnly`, so `npm publish` stops on a
// blocker. `--base <ref>` sets the commit the diff starts from.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const pluginDir = resolve(process.cwd());
const PASS = "No release blockers found.";
const MAX_INLINE_DIFF = 200_000;

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

// npm, codex and claude are .cmd shims on Windows, which only run through a shell.
function quote(arg) {
  return isWindows && /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}

function run(command, args, { cwd = pluginDir, input, stdio = ["pipe", "pipe", "pipe"] } = {}) {
  return spawnSync(quote(command), args.map(quote), {
    cwd,
    input,
    stdio,
    shell: isWindows,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function git(...args) {
  const result = run("git", args);
  if (result.error || result.status !== 0) fail(`git ${args.join(" ")} failed:\n${result.stderr ?? result.error}`);
  return result.stdout.trim();
}

function parseArgs(argv) {
  const options = { base: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base" && argv[i + 1]) options.base = argv[++i];
    else fail(`Unknown argument "${argv[i]}". Usage: security-review.mjs [--base <ref>]`);
  }
  return options;
}

function commitExists(ref) {
  return run("git", ["cat-file", "-e", `${ref}^{commit}`]).status === 0;
}

// npm records the commit each version was published from as gitHead. A squash
// merge can leave that commit only on GitHub, so fetch it by hash if needed.
function lastPublishedCommit(name) {
  const view = run("npm", ["view", name, "--json"]);
  if (view.status !== 0) {
    console.log(`> ${name} isn't on npm yet, so the whole plugin is reviewed.`);
    return undefined;
  }
  const published = JSON.parse(view.stdout);
  const head = published.gitHead;
  if (!head) {
    console.log(`> npm has no commit for ${name}@${published.version}, so the whole plugin is reviewed.`);
    return undefined;
  }
  if (!commitExists(head)) run("git", ["fetch", "--quiet", "origin", head]);
  if (!commitExists(head)) {
    console.log(`> Commit ${head} of ${name}@${published.version} isn't available, so the whole plugin is reviewed.`);
    return undefined;
  }
  console.log(`> Last published: ${name}@${published.version} from ${head.slice(0, 12)}.`);
  return head;
}

function buildPrompt({ threatModel, pluginPath, name, version, head, base }) {
  const scope = base
    ? (() => {
        const range = `${base}..${head}`;
        // git runs in the plugin folder, so :(top) anchors the path at the repo root.
        const files = git("diff", "--name-status", range, "--", `:(top)${pluginPath}/`);
        const diff = git("diff", range, "--", `:(top)${pluginPath}/`);
        const diffText =
          diff.length <= MAX_INLINE_DIFF
            ? `\`\`\`diff\n${diff}\n\`\`\``
            : "The diff is too long to include. Read each changed file listed above in full.";
        return [
          `Changes since the last published version (\`git diff ${range} -- ${pluginPath}/\`):`,
          "",
          files ? `\`\`\`\n${files}\n\`\`\`` : "(no files changed)",
          "",
          diffText,
        ].join("\n");
      })()
    : "This plugin has no earlier published version to compare against. Review all of it.";

  return [
    `You are a security reviewer for the Paseo plugin \`${name}\` version ${version}, in the folder \`${pluginPath}/\` of this repository at commit ${head}. You did not write it. Do not change any files.`,
    "",
    "Review it against this threat model:",
    "",
    "<threat-model>",
    threatModel,
    "</threat-model>",
    "",
    scope,
    "",
    `What ships is the files that \`npm pack\` puts in this plugin's package (the \`files\` list in \`${pluginPath}/package.json\`). The repo's \`scripts/\` folder and the package.json lifecycle scripts, like \`prepublishOnly\`, run only in the maintainer's own checkout of this repo, which the attacker doesn't control. Leave them out.`,
    "",
    `Judge the whole plugin as it will ship, but spend most of your attention on what changed. Read the code the changes touch and anything they reach. Report only release blockers, meaning findings that break items 1 to 4 of "What must never happen". Leave out hardening ideas and follow-ups.`,
    "",
    "Start each blocker with a line `BLOCKER: <one-line summary>`, then give the file and line, the exact content or agent output that triggers it, the steps and the harm, and whether you ran it or reasoned it from the source.",
    "",
    "Before the verdict, list each place in the plugin that touches files, programs, HTML or the network, one line each, with why it is or isn't safe.",
    "",
    `If there are no release blockers, end your reply with exactly this line and nothing after it:\n${PASS}`,
  ].join("\n");
}

// Each reviewer returns its final message, or undefined when it can't run.
// Their progress output goes to logPath.
const reviewers = {
  codex(prompt, repoRoot, logPath) {
    const out = join(tmpdir(), `security-review-${process.pid}.md`);
    rmSync(out, { force: true });
    const log = openSync(logPath, "w");
    const result = run(
      "codex",
      ["exec", "--sandbox", "read-only", "--ephemeral", "-C", repoRoot, "-o", out, "-"],
      { cwd: repoRoot, input: prompt, stdio: ["pipe", log, log] },
    );
    closeSync(log);
    if (result.error || result.status !== 0 || !existsSync(out)) {
      console.log(`> codex didn't finish (${result.error?.code ?? `exit ${result.status}`}).`);
      return undefined;
    }
    const text = readFileSync(out, "utf8").trim();
    rmSync(out, { force: true });
    return text || undefined;
  },
  // --restricted drops Bash and WebFetch and keeps file tools inside the repo;
  // --tools then leaves only the read-only ones.
  claude(prompt, repoRoot, logPath) {
    const log = openSync(logPath, "w");
    const result = run(
      "claude",
      [
        "-p",
        "--restricted",
        "--strict-mcp-config",
        "--tools",
        "Read,Grep,Glob",
        "--permission-mode",
        "dontAsk",
        "--no-session-persistence",
      ],
      { cwd: repoRoot, input: prompt, stdio: ["pipe", "pipe", log] },
    );
    closeSync(log);
    if (result.error || result.status !== 0) {
      console.log(`> claude didn't finish (${result.error?.code ?? `exit ${result.status}`}).`);
      return undefined;
    }
    return result.stdout.trim() || undefined;
  },
};

const BLOCKER_LINE = /^\W*BLOCKER:/;

// A review that lists a blocker fails even if it also ends with the pass line.
function passed(text) {
  const lines = text.trim().split("\n");
  return lines[lines.length - 1].trim() === PASS && !lines.some((line) => BLOCKER_LINE.test(line));
}

function header(text, key) {
  return text.match(new RegExp(`^- ${key}: (.+)$`, "m"))?.[1].trim();
}

const options = parseArgs(process.argv.slice(2));
if (!existsSync(join(pluginDir, "paseo-plugin.json"))) fail(`No paseo-plugin.json in ${pluginDir}. Run this from a plugin directory.`);
const { name, version } = JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf8"));
const repoRoot = git("rev-parse", "--show-toplevel");
const pluginPath = relative(repoRoot, pluginDir);
const threatModelPath = join(repoRoot, "THREAT-MODEL.md");
if (!existsSync(threatModelPath)) fail(`No THREAT-MODEL.md in ${repoRoot}.`);

const dirty = git("status", "--porcelain", "--", ".");
if (dirty) fail(`${pluginPath}/ has uncommitted changes. Commit them first, so the review covers what gets published:\n${dirty}`);

const head = git("rev-parse", "HEAD");
const tree = git("rev-parse", `HEAD:${pluginPath}`);
const reportDir = join(repoRoot, ".scratch", "security-review");
const reportPath = join(reportDir, `${basename(pluginDir)}-${version}.md`);

let base;
if (options.base) {
  if (!commitExists(options.base)) fail(`--base ${options.base} isn't a commit here.`);
  base = git("rev-parse", options.base);
} else {
  base = lastPublishedCommit(name);
}

// A publish retried after a 2FA typo reuses the passing review, as long as the
// plugin's files, the range, the threat model and this script are all unchanged.
const threatModel = readFileSync(threatModelPath, "utf8");
const key = createHash("sha256")
  .update(JSON.stringify([tree, base ?? "none", threatModel, readFileSync(fileURLToPath(import.meta.url), "utf8")]))
  .digest("hex");
if (existsSync(reportPath)) {
  const previous = readFileSync(reportPath, "utf8");
  if (header(previous, "Key") === key && passed(previous)) {
    console.log(`> Reusing the passing review in ${reportPath}. Nothing it covered has changed.`);
    process.exit(0);
  }
}
const range = base ? `${base}..${head} -- ${pluginPath}/` : `none (whole plugin at ${head})`;
const prompt = buildPrompt({ threatModel, pluginPath, name, version, head, base });

let reviewer;
let review;
const started = Date.now();
mkdirSync(reportDir, { recursive: true });
for (const candidate of ["codex", "claude"]) {
  const logPath = reportPath.replace(/\.md$/, `.${candidate}.log`);
  console.log(`> Reviewing ${name}@${version} with ${candidate}. This can take several minutes. Progress: ${logPath}`);
  review = reviewers[candidate](prompt, repoRoot, logPath);
  if (review) {
    reviewer = candidate;
    break;
  }
}
if (!review) fail("Neither codex nor claude could run the security review, so the publish stops here.");
const minutes = ((Date.now() - started) / 60000).toFixed(1);

writeFileSync(
  reportPath,
  [
    `# Security review: ${name}@${version}`,
    "",
    `- Reviewer: ${reviewer}`,
    `- Commit: ${head}`,
    `- Tree: ${tree}`,
    `- Diff: ${range}`,
    `- Date: ${new Date().toISOString()}`,
    `- Minutes: ${minutes}`,
    `- Key: ${key}`,
    "",
    review,
    "",
  ].join("\n"),
);

console.log(`> Reviewer: ${reviewer}, ${minutes} min. Report: ${reportPath}`);
if (passed(review)) {
  console.log(`> ${PASS}`);
  process.exit(0);
}
const blockers = review.split("\n").filter((line) => BLOCKER_LINE.test(line));
fail(
  [
    `Security review found release blockers in ${name}@${version}. Fix them and publish again.`,
    ...(blockers.length ? blockers : ["(The review didn't end with the pass line. Read the report.)"]),
    `Report: ${reportPath}`,
  ].join("\n"),
);
