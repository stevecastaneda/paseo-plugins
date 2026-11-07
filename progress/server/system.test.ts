import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LAUNCH_FOLDER, makeFoldersIn, runProgram, writeFileIn } from "./system.ts";

async function scratch(t: test.TestContext): Promise<string> {
  const folder = realpathSync(await mkdtemp(join(tmpdir(), "progress-system-")));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test("a program starts in the launch folder unless the caller names one", async (t) => {
  const print = ["-e", "process.stdout.write(process.cwd())"];
  assert.equal((await runProgram(process.execPath, print)).stdout, realpathSync(LAUNCH_FOLDER));
  const folder = await scratch(t);
  assert.equal((await runProgram(process.execPath, print, { cwd: folder })).stdout, folder);
});

test("a write stays inside the folder it names", async (t) => {
  const folder = await scratch(t);
  await mkdir(join(folder, "inside"));
  await assert.rejects(writeFileIn(join(folder, "inside"), "../escaped.txt", "x"), /not a name inside/);
  await assert.rejects(writeFileIn(join(folder, "inside"), join(folder, "absolute.txt"), "x"), /not a name inside/);
  assert.equal(existsSync(join(folder, "escaped.txt")), false);
  assert.equal(existsSync(join(folder, "absolute.txt")), false);
  await writeFileIn(join(folder, "inside"), join("new", "file.txt"), "kept", { atomic: true });
  assert.equal(await readFile(join(folder, "inside", "new", "file.txt"), "utf8"), "kept");
});

test("a write never passes through a linked folder", async (t) => {
  const folder = await scratch(t);
  await mkdir(join(folder, "repo"));
  await mkdir(join(folder, "elsewhere"));
  await symlink(join(folder, "elsewhere"), join(folder, "repo", "linked"), "junction");
  await assert.rejects(writeFileIn(join(folder, "repo"), join("linked", "file.txt"), "x"), /is a link/);
  assert.equal(await makeFoldersIn(join(folder, "repo"), join("linked", "runs")), null);
  assert.equal(existsSync(join(folder, "elsewhere", "file.txt")), false);
  assert.equal(existsSync(join(folder, "elsewhere", "runs")), false);
});
