import * as fs from "fs"
import * as path from "path"
import type { SimpleGit } from "simple-git"
import { STATE_DIR } from "./constants"

const EXCLUDE_ITEMS = [
  [".kilo/worktrees/", "Kilo Code agent worktrees"],
  [`${STATE_DIR}/agent-manager.json`, "Kilo Agent Manager state"],
  [".kilo/agent-manager.json", "Kilo Agent Manager legacy state"],
  [".kilo/setup-script", "Kilo Code worktree setup script"],
  [".kilo/setup-script.sh", "Kilo Code worktree setup script"],
  [".kilo/setup-script.ps1", "Kilo Code worktree setup script"],
  [".kilo/setup-script.cmd", "Kilo Code worktree setup script"],
  [".kilo/setup-script.bat", "Kilo Code worktree setup script"],
  [".kilocode/worktrees/", "Kilo Code legacy agent worktrees"],
  [".kilocode/agent-manager.json", "Kilo Agent Manager legacy state"],
  [".kilocode/setup-script", "Kilo Code legacy worktree setup script"],
  [".kilocode/setup-script.sh", "Kilo Code legacy worktree setup script"],
  [".kilocode/setup-script.ps1", "Kilo Code legacy worktree setup script"],
  [".kilocode/setup-script.cmd", "Kilo Code legacy worktree setup script"],
  [".kilocode/setup-script.bat", "Kilo Code legacy worktree setup script"],
] as const

/**
 * Resolve the repository exclude file and the repository-relative path to `root`, then append
 * any missing Kilo exclude entries in a single read/append pass.
 */
export async function ensureRepoGitExclude(git: SimpleGit, root: string, log: (msg: string) => void): Promise<void> {
  const [rawExclude, rawPrefix] = await Promise.all([
    git.raw(["rev-parse", "--git-path", "info/exclude"]),
    git.raw(["rev-parse", "--show-prefix"]),
  ])
  const exclude = rawExclude.trim()
  if (!exclude || exclude.startsWith("--")) throw new Error("git rev-parse did not return an exclude path")
  const file = path.resolve(root, exclude)
  const prefix = rawPrefix.trim()

  const infoDir = path.dirname(file)
  if (!fs.existsSync(infoDir)) await fs.promises.mkdir(infoDir, { recursive: true })

  let content = ""
  try {
    content = await fs.promises.readFile(file, "utf-8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  const existing = new Set(content.split(/\r?\n/))
  const additions: Array<{ entry: string; comment: string }> = []
  for (const [raw, comment] of EXCLUDE_ITEMS) {
    const entry = `${prefix}${raw}`
    if (existing.has(entry)) continue
    existing.add(entry)
    additions.push({ entry, comment })
  }
  if (additions.length === 0) return

  let block = ""
  let hasTrailingNewline = content.endsWith("\n") || content === ""
  for (const { entry, comment } of additions) {
    const pad = hasTrailingNewline ? "" : "\n"
    block += `${pad}\n# ${comment}\n${entry}\n`
    hasTrailingNewline = true
  }
  await fs.promises.appendFile(file, block)
  for (const { entry } of additions) {
    log(`Added ${entry} to ${file}`)
  }
}
