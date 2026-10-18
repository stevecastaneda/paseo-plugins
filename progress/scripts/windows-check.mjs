// Checks that paseo-progress and Install skill find Paseo when its command is
// a .cmd file, the way Paseo Desktop ships it on Windows (#84), and that
// PowerShell and cmd can run paseo-progress. Mac tests can't see this, so CI
// runs it on Windows; elsewhere it runs only the checks that apply.
// Usage: node scripts/windows-check.mjs. Exits 1 if any check fails.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const windows = process.platform === "win32";
const pluginDir = fileURLToPath(new URL("..", import.meta.url));
// A space in every path, like "C:\Users\Jane Doe".
const work = mkdtempSync(join(tmpdir(), "progress windows "));
const home = join(work, "home dir");
const binDir = join(home, ".local", "bin");
const ECHO = "REPORTED-COPY";
// The copy of the plugin the stand-in Paseo reports. Its command only echoes
// its arguments, so a pass proves the launcher asked the stand-in.
const reported = join(work, "reported plugin");
mkdirSync(join(reported, "server"), { recursive: true });
mkdirSync(join(reported, "skills", "paseo-progress"), { recursive: true });
writeFileSync(join(reported, "server", "cli.ts"), `console.log("${ECHO} " + JSON.stringify(process.argv.slice(2)));\n`);

// A stand-in for Paseo's command. It answers `plugin ls progress --json` and
// fails on any other arguments, so quoting mistakes show up.
function standInPaseo(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "stand-in.mjs"), [
    `const args = process.argv.slice(2);`,
    `if (args.join(" ") !== "plugin ls progress --json") { console.error("stand-in paseo got: " + JSON.stringify(args)); process.exit(2); }`,
    `console.log(JSON.stringify([{ id: "progress", path: ${JSON.stringify(reported)} }]));`,
  ].join("\n"));
  if (windows) {
    const path = join(dir, "paseo.cmd");
    writeFileSync(path, `@echo off\r\n"${process.execPath}" "%~dp0stand-in.mjs" %*\r\nexit /b %errorlevel%\r\n`);
    return path;
  }
  const path = join(dir, "paseo");
  writeFileSync(path, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/stand-in.mjs" "$@"\n`, { mode: 0o755 });
  return path;
}

const onPathDir = join(work, "paseo on path");
standInPaseo(onPathDir);
const namedCli = standInPaseo(join(work, "paseo named"));
const localAppData = join(work, "local app data");
if (windows) standInPaseo(join(localAppData, "Programs", "Paseo", "resources", "bin"));

// Windows keeps PATH as "Path"; adding a second "PATH" key would be ambiguous.
const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
function env(extra = {}, pathPrefix = []) {
  const result = { ...process.env, USERPROFILE: home, HOME: home, LOCALAPPDATA: localAppData };
  for (const key of ["PASEO_BIN", "PASEO_CLI", "PASEO_PROGRESS_PLUGIN_DIR"]) delete result[key];
  result[pathKey] = [...pathPrefix, process.env[pathKey]].join(windows ? ";" : ":");
  return { ...result, ...extra };
}

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  const out = ((result.stdout ?? "") + (result.stderr ?? "")).trim();
  return { code: result.status, out, detail: out || `exit ${result.status} ${result.error?.message ?? ""}` };
}

// Runs one of the plugin's server functions in a child with the given env.
function serverCall(env, module, expression) {
  const url = pathToFileURL(join(pluginDir, "server", module)).href;
  const script = `const m = await import(${JSON.stringify(url)}); console.log(JSON.stringify(await (${expression})(m)));`;
  return run(process.execPath, ["--input-type=module", "-e", script], { env });
}

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail.split("\n").slice(0, 6).join("\n      ")}`}`);
}

const install = serverCall(env(), "launcher.ts", "(m) => m.handleInstallLauncher()");
check("Install command writes the launcher", install.code === 0 && existsSync(join(binDir, "paseo-progress")), install.detail);

const help = `${ECHO} ["--help"]`;
function launcherFinds(name, env) {
  const r = run(process.execPath, [join(binDir, "paseo-progress"), "--help"], { env });
  check(`the command finds ${name}`, r.code === 0 && r.out === help, r.detail);
}
launcherFinds("paseo on PATH", env({}, [onPathDir]));
launcherFinds("PASEO_BIN", env({ PASEO_BIN: namedCli }));
launcherFinds("PASEO_CLI, which Paseo gives agents", env({ PASEO_CLI: namedCli }));
if (windows) launcherFinds("Paseo Desktop's default install", env());

function skillFinds(name, env) {
  const r = serverCall(env, "skill.ts", "(m) => m.findPluginDirectory()");
  check(`Install skill finds ${name}`, r.code === 0 && r.out === JSON.stringify(reported), r.detail);
}
skillFinds("paseo on PATH", env({}, [onPathDir]));
skillFinds("PASEO_BIN", env({ PASEO_BIN: namedCli }));
skillFinds("PASEO_CLI", env({ PASEO_CLI: namedCli }));
if (windows) skillFinds("Paseo Desktop's default install", env());

const status = serverCall(env({}, [binDir + (windows ? "\\" : "/")]), "launcher.ts", "(m) => m.handleLauncherStatus()");
check("the panel sees the command's folder on PATH", status.code === 0 && JSON.parse(status.out || "{}").onPath === true, status.detail);

if (windows) {
  const again = serverCall(env(), "launcher.ts", "(m) => m.installLauncher(m.defaultLauncherPath())");
  check("a second Install command writes nothing", again.code === 0 && again.out === "false" && existsSync(join(binDir, "paseo-progress.cmd")), again.detail);
  const shellEnv = env({ PASEO_CLI: namedCli }, [binDir]);
  for (const [shell, args] of [["powershell", ["-NoProfile", "-Command", "paseo-progress --help"]], ["cmd", ["/d", "/c", "paseo-progress --help"]]]) {
    const r = run(shell, args, { env: shellEnv });
    check(`${shell} runs paseo-progress`, r.code === 0 && r.out === help, r.detail);
  }
  const asked = run("powershell", ["-NoProfile", "-Command", `paseo-progress question ask "Row spacing" "Even it out?" --option "A=Yes | 50% wider & done"`], { env: shellEnv });
  check("PowerShell passes quoted arguments intact", asked.out === `${ECHO} ["question","ask","Row spacing","Even it out?","--option","A=Yes | 50% wider & done"]`, asked.detail);
}

// Linking on its own, apart from finding Paseo, so each failure shows alone.
const paths = `m.defaultSkillPaths(${JSON.stringify(home)})`;
const linked = serverCall(env(), "skill.ts", `async (m) => { await m.installSkill(${paths}, ${JSON.stringify(reported)}); return (await m.skillStatus(${paths}, ${JSON.stringify(reported)})).state; }`);
check("Install skill links all three folders", linked.out === `"current"`, linked.detail);
if (windows) {
  // A junction needs no admin rights or Developer Mode; a directory symlink does.
  const link = join(home, ".claude", "skills", "paseo-progress");
  const type = run("powershell", ["-NoProfile", "-Command", `(Get-Item -LiteralPath '${link}').LinkType`]);
  check("the skill link is a junction", type.out === "Junction", type.detail);
  const moved = join(work, "moved plugin");
  mkdirSync(join(moved, "skills", "paseo-progress"), { recursive: true });
  const relinked = serverCall(env(), "skill.ts", `async (m) => { const before = (await m.skillStatus(${paths}, ${JSON.stringify(moved)})).state; await m.installSkill(${paths}, ${JSON.stringify(moved)}); return [before, (await m.skillStatus(${paths}, ${JSON.stringify(moved)})).state]; }`);
  check("a link to an old copy of the plugin is replaced", relinked.out === `["outdated","current"]`, relinked.detail);
}

rmSync(work, { recursive: true, force: true });
console.log(`\n${results.filter(Boolean).length} of ${results.length} checks pass (${process.platform}, Node ${process.version})`);
process.exit(results.every(Boolean) ? 0 : 1);
