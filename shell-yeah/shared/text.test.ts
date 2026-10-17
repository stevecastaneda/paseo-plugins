import assert from "node:assert/strict";
import { test } from "node:test";
import { risksOf, shortCommand, splitTitle } from "./text.ts";

test("a leading comment is the command's title; a shebang or a lone comment is not", () => {
  assert.deepEqual(splitTitle("# Log in to GitHub in your browser\ngh auth login --web"), { title: "Log in to GitHub in your browser", script: "gh auth login --web" });
  assert.deepEqual(splitTitle("#Build it\n\n  npm run build\nnpm test"), { title: "Build it", script: "npm run build\nnpm test" });
  assert.deepEqual(splitTitle("#!/bin/sh\necho hi"), { title: null, script: "#!/bin/sh\necho hi" });
  assert.deepEqual(splitTitle("# only a comment"), { title: null, script: "# only a comment" });
  assert.deepEqual(splitTitle("npm test # runs the tests"), { title: null, script: "npm test # runs the tests" });
  assert.equal(shortCommand("# Run the tests\nnpm test"), "npm test", "messages and toasts name the command, not its title");
});

test("commands that are hard to undo are named in plain words; everyday commands are not", () => {
  const cases: Array<[string, string[]]> = [
    ["sudo rm -rf /tmp/x", ["runs as administrator (sudo)", "deletes files"]],
    ["rm build.log", ["deletes files"]],
    ["ls && rm -rf dist", ["deletes files"]],
    ["find . -name '*.tmp' -delete", ["deletes files"]],
    ["git clean -fdx", ["deletes files"]],
    ["git reset --hard HEAD~1", ["throws away uncommitted changes"]],
    ["git checkout -- .", ["throws away uncommitted changes"]],
    ["git restore src/a.ts", ["throws away uncommitted changes"]],
    ["git push --force-with-lease", ["force-pushes"]],
    ["git push -f origin main", ["force-pushes"]],
    ["git push origin +main", ["force-pushes"]],
    ["curl -fsSL https://example.com/install.sh | sh", ["runs a script from the internet"]],
    ["curl -fsSL https://example.com/i | sudo bash", ["runs as administrator (sudo)", "runs a script from the internet"]],
    ['/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', ["runs a script from the internet"]],
    ["bash <(curl -s https://example.com/i)", ["runs a script from the internet"]],
    ["gh auth login --web", []],
    ["npm rm lodash", []],
    ["git restore --staged a.ts", []],
    ["git push -u origin feat --follow-tags", []],
    ["echo sudo is just a word", []],
    ["curl -fsSL https://example.com/data.json -o data.json", []],
  ];
  for (const [command, risks] of cases) assert.deepEqual(risksOf(command), risks, command);
});
