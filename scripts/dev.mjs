// Checks the plugin in the current directory, then points Paseo at it.
// Run through `npm run dev` from a plugin directory.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const isWindows = process.platform === "win32";
const macAppCli = "/Applications/Paseo.app/Contents/Resources/bin/paseo";
const pluginDir = resolve(process.cwd());

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

// npm and paseo are .cmd shims on Windows, which only run through a shell.
function quote(arg) {
  return isWindows && /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(quote(command), args.map(quote), {
    cwd: pluginDir,
    shell: isWindows,
    encoding: "utf8",
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  return result;
}

function findPaseo() {
  const onPath = spawnSync(quote("paseo"), ["--version"], { shell: isWindows, stdio: "ignore" });
  if (!onPath.error && onPath.status === 0) return "paseo";
  if (process.platform === "darwin" && existsSync(macAppCli)) return macAppCli;
  fail(
    "Could not find the paseo CLI. Put `paseo` on your PATH, or install the Paseo desktop app.",
  );
}

function paseo(cli, args, options) {
  const result = run(cli, args, options);
  if (result.status !== 0) fail(`\`paseo ${args.join(" ")}\` failed.`);
  return result;
}

const manifestPath = join(pluginDir, "paseo-plugin.json");
if (!existsSync(manifestPath)) fail(`No paseo-plugin.json in ${pluginDir}. Run this from a plugin directory.`);
const { id } = JSON.parse(readFileSync(manifestPath, "utf8"));

for (const script of ["typecheck", "test"]) {
  console.log(`\n> npm run ${script}`);
  if (run("npm", ["run", script]).status !== 0) fail(`npm run ${script} failed; not loading ${id} into Paseo.`);
}

const cli = findPaseo();
const findPlugin = () =>
  JSON.parse(paseo(cli, ["plugin", "ls", "--json"], { capture: true }).stdout).find(
    (plugin) => plugin.id === id,
  );
const current = findPlugin();

if (current && current.path && resolve(current.path) === pluginDir) {
  console.log(`\n> paseo plugin reload ${id}`);
  paseo(cli, ["plugin", "reload", id]);
} else {
  if (current) {
    console.log(`\n${id} is installed from ${current.path ?? "another source"}; switching it to ${pluginDir}.`);
    console.log(`> paseo plugin remove ${id}`);
    paseo(cli, ["plugin", "remove", id]);
  }
  console.log(`> paseo plugin install ${pluginDir}`);
  // A plugin that installs but fails to start stays configured; one rejected
  // before that (bad manifest, unsupported Paseo version) is left uninstalled.
  if (run(cli, ["plugin", "install", pluginDir]).status !== 0 && !findPlugin()) {
    const restore = current?.installation?.identity?.kind === "directory" ? current.path : null;
    if (restore && run(cli, ["plugin", "install", restore]).status === 0) {
      fail(`Install failed; ${id} is back on ${restore}.`);
    }
    fail(`Install failed and ${id} is not installed. Fix the error above and run npm run dev again.`);
  }
}

const loaded = findPlugin();
console.log(`\n${id}: ${loaded?.status ?? "missing"} from ${loaded?.path ?? "?"}`);
if (loaded?.status !== "running") fail(loaded?.error ?? `${id} is not running. See \`paseo plugin logs ${id}\`.`);
