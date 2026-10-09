// Installs the plugin in the current directory the way Paseo installs it from
// npm, once with the npm on PATH and once with the latest npm. Run through
// `npm run check:install` from a plugin directory before publishing.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const isWindows = process.platform === "win32";
const pluginDir = resolve(process.cwd());
const work = mkdtempSync(join(tmpdir(), "paseo-check-install-"));

function fail(message) {
  console.error(`\n${message}\nFiles kept in ${work}`);
  process.exit(1);
}

// npm is a .cmd shim on Windows, which only runs through a shell.
function quote(arg) {
  return isWindows && /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}

function run(command, args, cwd) {
  const result = spawnSync(quote(command), args.map(quote), { cwd, shell: isWindows, encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
}

function must(command, args, cwd, what) {
  const result = run(command, args, cwd);
  if (result.status !== 0) fail(`${what} failed (exit ${result.status}):\n${result.stdout}${result.stderr}`);
  return result.stdout.trim();
}

const manifestPath = join(pluginDir, "paseo-plugin.json");
if (!existsSync(manifestPath)) fail(`No paseo-plugin.json in ${pluginDir}. Run this from a plugin directory.`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const pkg = JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf8"));

console.log(`> npm pack`);
must("npm", ["pack", "--pack-destination", work], pluginDir, "npm pack");
const tarball = join(work, readdirSync(work).find((name) => name.endsWith(".tgz")));

const latestPrefix = join(work, "npm-latest");
must("npm", ["install", "--prefix", latestPrefix, "--no-audit", "--no-fund", "npm@latest"], work, "Fetching the latest npm");
const latestNpm = join(latestPrefix, "node_modules", ".bin", isWindows ? "npm.cmd" : "npm");

for (const npm of ["npm", latestNpm]) {
  const version = must(npm, ["--version"], work, "npm --version");
  const root = mkdtempSync(join(work, `npm-${version}-`));
  console.log(`\n> install with npm ${version}`);

  // Same package.json and flags as Paseo's npm acquisition
  // (packages/server/src/server/plugins/managed-source/npm.ts in Paseo 0.11.1).
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "paseo-plugin-installation",
      version: "1.0.0",
      private: true,
      dependencies: { [pkg.name]: `file:${tarball}` },
    }),
  );
  must(
    npm,
    [
      "install",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
      "--package-lock=true",
      "--lockfile-version=3",
      "--include=prod",
      "--omit=dev",
      "--global=false",
      "--workspaces=false",
    ],
    root,
    `npm ${version} install`,
  );

  // Paseo then runs the manifest's build commands inside the installed package.
  const installed = join(root, "node_modules", pkg.name);
  for (const [command, ...args] of manifest.build ?? []) {
    console.log(`> ${[command, ...args].join(" ")}`);
    must(command === "npm" ? npm : command, args, installed, `Build command "${[command, ...args].join(" ")}" with npm ${version}`);
  }

  // Every runtime dependency must resolve from the installed package, the way Node looks it up.
  for (const dependency of Object.keys(pkg.dependencies ?? {})) {
    let found = false;
    for (let dir = installed; !found; dir = dirname(dir)) {
      found = existsSync(join(dir, "node_modules", dependency, "package.json"));
      if (dir === dirname(dir)) break;
    }
    if (!found) fail(`${dependency} is not installed for ${pkg.name} with npm ${version}.`);
  }
  console.log(`ok: installs with npm ${version}`);
}

rmSync(work, { recursive: true, force: true });
