import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPty, pickSpawner } from "./proc.ts";

const posixTest = process.platform === "win32" ? test.skip : test;

posixTest("in a terminal, a command's last lines arrive even when the plugin reads slowly", { skip: loadPty() === null, timeout: 30_000 }, async () => {
  const spawner = await pickSpawner(process.env, "auto");
  assert.equal(spawner.terminal, true);
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await new Promise<string>((resolve, reject) => {
      let out = "";
      spawner.start(
        { file: "/bin/sh", args: ["-c", 'for i in $(seq 1 10000); do echo "line $i"; done'], cwd: "/tmp", env: process.env, flushMs: 0 },
        {
          data: (chunk) => {
            out += chunk;
            // A busy plugin: each read takes 5 ms.
            const until = Date.now() + 5;
            while (Date.now() < until);
          },
          exit: () => resolve(out),
          error: reject,
        },
      );
    });
    assert.equal(text.match(/line \d+/g)?.length, 10_000);
  }
});
