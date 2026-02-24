export interface BranchListItem {
  name: string
  isLocal: boolean
  isRemote: boolean
  isDefault: boolean
  lastCommitDate?: string
}

export interface PRUrlParts {
  owner: string
  repo: string
  number: number
}

export interface PRInfo {
  headRefName: string
  headRepositoryOwner?: { login: string }
  isCrossRepository: boolean
  title: string
}

export interface WorktreeEntry {
  path: string
  branch: string
  bare: boolean
  detached: boolean
}

export type PRErrorKind = "not_found" | "gh_missing" | "gh_auth" | "unknown"

export function parsePRUrl(url: string): PRUrlParts | null {
  let normalized = url.trim()
  if (!normalized.startsWith("http")) normalized = `https://${normalized}`
  normalized = normalized.replace(/\/+$/, "")
  const match = normalized.match(/\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) }
}

export function localBranchName(info: PRInfo): string {
  if (info.isCrossRepository) {
    const owner = info.headRepositoryOwner?.login?.toLowerCase()
    if (owner) return `${owner}/${info.headRefName}`
  }
  return info.headRefName
}

export function parseForEachRefOutput(raw: string): {
  locals: Set<string>
  remotes: Set<string>
  dates: Map<string, string>
} {
  const locals = new Set<string>()
  const remotes = new Set<string>()
  const dates = new Map<string, string>()

  for (const line of raw.split("\n")) {
    if (!line) continue
    const [ref, date] = line.split("\t")
    if (ref.includes("HEAD")) continue

    if (ref.startsWith("refs/heads/")) {
      const name = ref.slice(11)
      locals.add(name)
      if (date && !dates.has(name)) dates.set(name, date)
    } else if (ref.startsWith("refs/remotes/origin/")) {
      const name = ref.slice(20)
      remotes.add(name)
      if (date && !dates.has(name)) dates.set(name, date)
    }
  }

  return { locals, remotes, dates }
}

export function buildBranchList(
  locals: Set<string>,
  remotes: Set<string>,
  dates: Map<string, string>,
  defaultBranch: string,
): BranchListItem[] {
  const all = new Set([...locals, ...remotes])
  const branches: BranchListItem[] = [...all].map((name) => ({
    name,
    isLocal: locals.has(name),
    isRemote: remotes.has(name),
    isDefault: name === defaultBranch,
    lastCommitDate: dates.get(name),
  }))

  branches.sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1
    if (!a.isDefault && b.isDefault) return 1
    if (a.lastCommitDate && b.lastCommitDate) return b.lastCommitDate.localeCompare(a.lastCommitDate)
    return 0
  })

  return branches
}

export function parseWorktreeList(raw: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  for (const block of raw.split("\n\n")) {
    if (!block.trim()) continue
    const lines = block.split("\n")
    const wtPath = lines.find((l) => l.startsWith("worktree "))?.slice(9)
    if (!wtPath) continue

    const branchLine = lines.find((l) => l.startsWith("branch "))
    const bare = lines.some((l) => l === "bare")
    const detached = lines.some((l) => l === "detached")
    const branch = branchLine ? branchLine.slice(7).replace("refs/heads/", "") : detached ? "(detached)" : "unknown"

    entries.push({ path: wtPath, branch, bare, detached })
  }
  return entries
}

export function checkedOutBranchesFromWorktreeList(raw: string): Set<string> {
  const result = new Set<string>()
  for (const entry of parseWorktreeList(raw)) {
    if (!entry.bare && !entry.detached) result.add(entry.branch)
  }
  return result
}

const SAFE_GIT_REF = /^[a-zA-Z0-9._\-/]+$/

export function validateGitRef(value: string, label: string): void {
  if (!value || !SAFE_GIT_REF.test(value) || value.startsWith("-") || value.includes("..")) {
    throw new Error(`Unsafe ${label}: "${value}"`)
  }
}

export function classifyPRError(msg: string): PRErrorKind {
  if (msg.includes("command not found") || msg.includes("ENOENT") || msg.includes("is not recognized"))
    return "gh_missing"
  if (msg.includes("not logged") || msg.includes("auth login")) return "gh_auth"
  if (msg.includes("not found") || msg.includes("Could not resolve")) return "not_found"
  return "unknown"
}
