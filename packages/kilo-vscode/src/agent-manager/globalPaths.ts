/**
 * Global paths for agent manager data.
 *
 * Worktrees and state are stored globally (outside the repo) under:
 *   {xdgData}/kilo/agent-manager/{repoSlug}/
 *
 * This avoids polluting the user's repository with .kilocode/worktrees/ and
 * .kilocode/agent-manager.json, eliminating the need for git exclude entries.
 *
 * The setup script remains in-repo at {repo}/.kilocode/setup-script because
 * it is project-specific and user-editable.
 */

import * as path from "path"
import * as os from "os"
import * as crypto from "crypto"

const APP = "kilo"
const AGENT_MANAGER = "agent-manager"

/**
 * XDG_DATA_HOME or platform default:
 * - Linux/macOS: ~/.local/share
 * - Windows: %LOCALAPPDATA% (falls back to ~/.local/share)
 */
function xdgData(): string {
  if (process.env.XDG_DATA_HOME) return process.env.XDG_DATA_HOME
  if (process.platform === "win32") return process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share")
  return path.join(os.homedir(), ".local", "share")
}

/**
 * Deterministic slug for a repo root path.
 * Format: {dirName}-{shortHash} (e.g. "kilocode-a3b2c1d4")
 */
function repoSlug(root: string): string {
  const normalized = path.resolve(root)
  const name =
    path
      .basename(normalized)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/^-+|-+$/g, "") || "repo"
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 8)
  return `${name}-${hash}`
}

/** Base directory for a repo's agent manager data. */
export function agentManagerDir(root: string): string {
  return path.join(xdgData(), APP, AGENT_MANAGER, repoSlug(root))
}

/** Directory where worktrees are created for a repo. */
export function worktreeDir(root: string): string {
  return path.join(agentManagerDir(root), "worktrees")
}

/** Path to the agent manager state file for a repo. */
export function stateFile(root: string): string {
  return path.join(agentManagerDir(root), "agent-manager.json")
}

/** Old in-repo state file path (for migration). */
export function legacyStateFile(root: string): string {
  return path.join(root, ".kilocode", "agent-manager.json")
}

/** Old in-repo worktrees directory (for migration). */
export function legacyWorktreeDir(root: string): string {
  return path.join(root, ".kilocode", "worktrees")
}
