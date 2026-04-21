/**
 * Ensures Agent Manager artifacts (worktrees, state file, setup scripts) are
 * listed in .git/info/exclude so they do not pollute `git status` in users'
 * repos.
 *
 * Uses .git/info/exclude rather than the project .gitignore because these are
 * per-clone, local-only concerns — they should not be committed to the repo.
 *
 * Safe to call in any non-git context (returns silently) and safe to call
 * repeatedly (individual entries are skipped when already present).
 */

import * as fs from "fs"
import * as path from "path"

/** Entries written to .git/info/exclude, with human-readable section comments. */
const ENTRIES: readonly (readonly [string, string])[] = [
  [".kilo/worktrees/", "Kilo Code agent worktrees"],
  [".kilo/agent-manager.json", "Kilo Agent Manager state"],
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

type Log = (msg: string) => void

/**
 * Resolve the shared git directory for a working tree root.
 *
 * When root/.git is a directory, returns it directly.
 * When root/.git is a file (the repo itself is a worktree), follows the
 * `gitdir:` pointer up two levels to reach the shared .git directory.
 * Returns undefined when the path is not a git repo.
 */
async function resolveGitDir(root: string): Promise<string | undefined> {
  const gitPath = path.join(root, ".git")
  const stat = await fs.promises.stat(gitPath).catch(() => undefined)
  if (!stat) return undefined
  if (stat.isDirectory()) return gitPath

  const content = await fs.promises.readFile(gitPath, "utf-8").catch(() => undefined)
  if (!content) return undefined
  const match = content.match(/^gitdir:\s*(.+)$/m)
  if (!match?.[1]) return undefined
  return path.resolve(path.dirname(gitPath), match[1].trim(), "..", "..")
}

async function addEntry(excludePath: string, entry: string, comment: string, log?: Log): Promise<void> {
  const dir = path.dirname(excludePath)
  if (!fs.existsSync(dir)) await fs.promises.mkdir(dir, { recursive: true })

  let content = ""
  if (fs.existsSync(excludePath)) {
    content = await fs.promises.readFile(excludePath, "utf-8")
    if (content.includes(entry)) return
  }

  const pad = content.endsWith("\n") || content === "" ? "" : "\n"
  await fs.promises.appendFile(excludePath, `${pad}\n# ${comment}\n${entry}\n`)
  log?.(`Added ${entry} to ${excludePath}`)
}

/**
 * Append Agent Manager entries to .git/info/exclude for the given repo root.
 *
 * No-ops when the path is not a git repo. Errors writing individual entries
 * are surfaced via the optional `log` callback but never thrown — callers
 * should not have to wrap this in try/catch.
 */
export async function ensureKiloGitExclude(root: string, log?: Log): Promise<void> {
  const gitDir = await resolveGitDir(root)
  if (!gitDir) return

  const excludePath = path.join(gitDir, "info", "exclude")
  for (const [entry, comment] of ENTRIES) {
    await addEntry(excludePath, entry, comment, log).catch((err) => {
      log?.(`Failed to add ${entry} to ${excludePath}: ${err}`)
    })
  }
}
