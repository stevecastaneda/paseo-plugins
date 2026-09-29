import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PROGRESS_FILE } from "../shared/events.ts";

const SCRATCH_DIR = dirname(PROGRESS_FILE);

// Names only this plugin's files, so they stay out of git without the user
// editing their own .gitignore. Other files in .scratch/ are left to the repo.
export const SCRATCH_GITIGNORE = `# Added by the progress plugin for Paseo so its files stay out of git.
progress.jsonl
progress.jsonl.lock/
progress-panel-opened
.gitignore
`;

// Creates .scratch/ in the worktree and, the first time, its .gitignore. An
// existing .gitignore is the user's, so it is never touched.
export async function prepareScratch(root: string): Promise<void> {
  const directory = join(root, SCRATCH_DIR);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, ".gitignore"), SCRATCH_GITIGNORE, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
}
