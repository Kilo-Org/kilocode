import { Instance } from "@/project/instance"
import path from "path"
import { $ } from "bun"

/**
 * Normalize a project identifier: extract repo name from git URLs, truncate to 100 chars
 * @param input - Raw project identifier (URL or plain string)
 * @returns Normalized project ID
 */
function normalizeProjectId(input: string): string {
  const trimmed = input.trim()

  // Try parsing as URL (handles http://, https://, ssh://)
  try {
    const url = new URL(trimmed)
    // Extract last path segment and remove .git extension
    const pathname = url.pathname.replace(/\.git$/i, "")
    const parts = pathname.split("/").filter(Boolean)
    const repo = parts[parts.length - 1]
    return repo ? repo.slice(-100) : trimmed.slice(-100)
  } catch {
    // Not a standard URL - check for git@host:org/repo format (SCP-like syntax)
    const scpPattern = /^git@[^:]+:(.+)/i
    const match = scpPattern.exec(trimmed)
    if (match) {
      const pathPart = match[1].replace(/\.git$/i, "")
      const parts = pathPart.split("/").filter(Boolean)
      const repo = parts[parts.length - 1]
      return repo ? repo.slice(-100) : trimmed.slice(-100)
    }
  }

  // Plain string - return as-is, truncated to 100 chars
  return trimmed.slice(-100)
}

/**
 * Read project ID from .kilo/config.json, falling back to .kilocode/config.json
 * @param directory - Project directory
 * @returns Normalized project ID or undefined
 */
async function getProjectIdFromConfig(directory: string): Promise<string | undefined> {
  // Check .kilo first, then legacy .kilocode
  for (const dir of [".kilo", ".kilocode"]) {
    const file = Bun.file(path.join(directory, dir, "config.json"))
    const text = await file.text().catch(() => undefined)
    if (!text) continue

    try {
      const parsed = JSON.parse(text)
      const id = parsed?.project?.id
      // Trim whitespace/newlines to ensure valid HTTP header value
      if (typeof id === "string" && id.trim()) return normalizeProjectId(id)
    } catch {
      // Malformed JSON - try next location
    }
  }
  return undefined
}

/**
 * Read git origin remote URL using git command
 * @param directory - Project directory
 * @returns Normalized project ID from git origin URL or undefined
 */
async function getProjectIdFromGit(directory: string): Promise<string | undefined> {
  // Use git command to handle worktrees correctly (git resolves .git symlinks/files)
  const url = await $`git config --get remote.origin.url`
    .cwd(directory)
    .quiet()
    .nothrow()
    .text()
    .then((x) => x.trim())
    .catch(() => undefined)

  return url ? normalizeProjectId(url) : undefined
}

/**
 * Resolve project ID with priority: .kilo/config.json -> .kilocode/config.json -> git origin URL
 * @returns Normalized project ID or undefined
 */
async function resolveProjectId(): Promise<string | undefined> {
  const dir = Instance.directory

  // Priority 1: .kilo/config.json (falls back to .kilocode/config.json)
  const id = await getProjectIdFromConfig(dir)
  if (id) return id

  // Priority 2: git origin URL
  return getProjectIdFromGit(dir)
}

/**
 * Per-project cached state for project ID
 */
const state = Instance.state(async () => {
  const id = await resolveProjectId()
  return { id }
})

/**
 * Get the project ID for the current Instance context (cached per-project)
 * @returns Normalized project ID or undefined
 */
export async function getKiloProjectId(): Promise<string | undefined> {
  return (await state()).id
}
