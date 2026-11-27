import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

/**
 * Resolves the main repository checkout from a package root (`<checkout>/packages/kilo-vscode`), following a git
 * worktree's `.git` pointer and `commondir` so every worktree of the same repository maps to one root.
 */
export function mainCheckout(extensionRoot: string): string {
  const checkout = path.resolve(extensionRoot, "..", "..")
  const dotGit = path.join(checkout, ".git")
  // A main checkout has a `.git` directory; only a worktree has the `gitdir:` pointer file.
  const entry = statSync(dotGit, { throwIfNoEntry: false })
  if (!entry || entry.isDirectory()) return checkout
  const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))
  if (!match?.[1]) return checkout
  const gitDir = path.resolve(checkout, match[1].trim())
  const commonFile = path.join(gitDir, "commondir")
  const common = existsSync(commonFile) ? path.resolve(gitDir, readFileSync(commonFile, "utf8").trim()) : gitDir
  if (path.basename(common) !== ".git") return checkout
  const main = path.dirname(common)
  if (!existsSync(path.join(main, "packages", "kilo-vscode"))) return checkout
  return main
}

/**
 * Picks the `KILO_V2_PROFILE` directory for `bun run extension`:
 * 1. Explicit `KILO_V2_PROFILE` always wins.
 * 2. `--fresh` and `--isolated` keep the profile inside the per-run/per-worktree `state` directory.
 * 3. Default shares `<main-repo>/packages/kilo-vscode/.kilo-dev/profile` across worktrees, separate from installed
 *    Kilo v2 (`~/.local/share/kilo2`) and `bun dev` (`packages/kilo-cli/.kilo-v2-dev`).
 */
export function launchProfile(input: {
  root: string
  state: string
  env: NodeJS.ProcessEnv
  fresh: boolean
  isolated: boolean
}): string {
  if (input.env.KILO_V2_PROFILE) return input.env.KILO_V2_PROFILE
  if (input.fresh || input.isolated) return path.join(input.state, "profile")
  return path.join(mainCheckout(input.root), "packages", "kilo-vscode", ".kilo-dev", "profile")
}
