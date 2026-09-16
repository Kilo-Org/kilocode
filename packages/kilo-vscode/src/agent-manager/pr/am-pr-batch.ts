/**
 * Batched PR lookup for a full Agent Manager sync.
 *
 * One GraphQL document resolves every worktree in a chunk by head ref name,
 * with a HEAD-SHA fallback for same-repo PRs whose local branch was renamed.
 * The result is reshaped into the `gh pr view --json` shape so the shared
 * `parsePRResult` parser is reused unchanged.
 */

export const CHUNK = 10

export interface BatchItem {
  branch: string
  head?: string
}

export interface BatchNode {
  number?: number
  state?: string
  headRefOid?: string
  isCrossRepository?: boolean
  [key: string]: unknown
}

/** `home` is the repository default branch, used to hide stale merged PRs for it like gh does. */
export type BatchResult = { nodes: BatchNode[]; home?: string } | { error: string }

const FIELDS =
  "id number title body url state isDraft reviewDecision additions deletions changedFiles headRefName baseRefOid headRefOid mergeCommit { oid } isCrossRepository createdAt author { login }"

// Mirrors the limits and shape `gh pr view --json` uses (cli/cli api/query_builder.go)
// so full-sync results and active-tick results hash identically.
const RICH = `${FIELDS} mergeable mergeStateStatus autoMergeRequest { mergeMethod } reviewRequests(first: 100) { nodes { requestedReviewer { ... on User { login avatarUrl } ... on Team { name } } } } reviews(first: 100) { nodes { author { login avatarUrl } state } } commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { totalCount nodes { __typename ... on CheckRun { name status conclusion detailsUrl startedAt completedAt checkSuite { workflowRun { workflow { name } } } } ... on StatusContext { context state targetUrl createdAt } } } } } } }`

/** Build one GraphQL document for a chunk of worktrees. */
export function query(items: BatchItem[], rich: boolean): string {
  const fields = rich ? RICH : FIELDS
  const aliases: string[] = []
  items.forEach((item, index) => {
    if (item.branch && item.branch !== "HEAD") {
      // Same states and ordering as gh's finder (pkg/cmd/pr/shared/finder.go) so a
      // merged PR keeps showing as merged instead of disappearing.
      aliases.push(
        `b${index}: pullRequests(headRefName: ${JSON.stringify(item.branch)}, states: [OPEN, CLOSED, MERGED], first: 5, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ${fields} } }`,
      )
    }
    if (item.head) {
      aliases.push(
        `c${index}: object(oid: ${JSON.stringify(item.head)}) { ... on Commit { associatedPullRequests(first: 3) { nodes { ${fields} } } } }`,
      )
    }
  })
  // Nothing to resolve; callers skip the request instead of sending unused variables.
  if (aliases.length === 0) return ""
  return `query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    defaultBranchRef { name }
    ${aliases.join("\n    ")}
  }
  rateLimit { cost }
}`
}

/** Convert one GraphQL PR node into the `gh pr view --json` shape. */
export function reshape(node: BatchNode): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: node.id,
    number: node.number,
    title: node.title,
    body: node.body,
    url: node.url,
    state: node.state,
    isDraft: node.isDraft,
    reviewDecision: node.reviewDecision,
    additions: node.additions,
    deletions: node.deletions,
    changedFiles: node.changedFiles,
    headRefName: node.headRefName,
    baseRefOid: node.baseRefOid,
    headRefOid: node.headRefOid,
    mergeCommit: node.mergeCommit,
    isCrossRepository: node.isCrossRepository,
    createdAt: node.createdAt,
    author: node.author,
  }
  if (node.mergeable !== undefined) result.mergeable = node.mergeable
  if (node.mergeStateStatus !== undefined) result.mergeStateStatus = node.mergeStateStatus
  if (node.autoMergeRequest !== undefined) result.autoMergeRequest = node.autoMergeRequest
  const requests = selection(node.reviewRequests)
  if (requests) result.reviewRequests = requests
  const reviews = selection(node.reviews)
  if (reviews) result.reviews = reviews
  const checks = flatten(node)
  if (checks) result.statusCheckRollup = checks
  return result
}

/**
 * Parse a batch response into one result per item. Errors are mapped back to
 * their alias; an error without a usable path fails the whole chunk.
 */
export function parse(json: string, items: BatchItem[]): BatchResult[] {
  const payload = JSON.parse(json) as { data?: Record<string, unknown>; errors?: unknown }
  const errors = Array.isArray(payload.errors) ? (payload.errors as Array<{ message?: unknown; path?: unknown }>) : []
  const results: BatchResult[] = items.map(() => ({ nodes: [] }))
  const build = () => {
    const message = errors.map((entry) => String(entry.message ?? "Batch request failed")).at(0)
    return { error: message ?? "Batch request failed" }
  }
  for (const entry of errors) {
    const alias = Array.isArray(entry.path) ? entry.path[1] : undefined
    const index = typeof alias === "string" ? aliasIndex(alias, items.length) : -1
    if (index < 0) return items.map(build)
    results[index] = { error: String(entry.message ?? "Batch request failed") }
  }
  const data = payload.data?.repository
  const repo = data && typeof data === "object" ? (data as Record<string, unknown>) : undefined
  // A response without the repository payload is a failed request, not "no PRs".
  if (!repo) return items.map(() => ({ error: "Batch response has no repository data" }))
  const ref = repo.defaultBranchRef as { name?: unknown } | null | undefined
  const home = typeof ref?.name === "string" ? ref.name : undefined
  for (let i = 0; i < items.length; i++) {
    if ("error" in results[i]!) continue
    results[i] = { nodes: merge(repo, i, items[i]!.head), home }
  }
  return results
}

/**
 * Choose the PR for a worktree the way gh's finder does: open PRs win, then the
 * newest merged or closed PR unless the branch is the default branch.
 *
 * `headRefName` also matches fork PRs whose branch merely shares the name
 * (`main` alone matches dozens of fork PRs), while gh compares the
 * `owner:branch` head label. A fork PR is therefore only a candidate when the
 * local HEAD SHA proves the checkout is that fork branch. Several remaining
 * open candidates are ambiguous and return undefined so the legacy path decides.
 */
export function pick(nodes: BatchNode[], head?: string, closed = true): BatchNode | undefined {
  const mine = own(nodes, head)
  const open = mine.filter((node) => node.state === "OPEN")
  if (head) {
    const match = open.find((node) => node.headRefOid === head)
    if (match) return match
  }
  if (open.length === 1) return open.at(0)
  if (open.length > 1) return undefined
  if (!closed) return undefined
  const rest = mine.filter((node) => node.state === "CLOSED" || node.state === "MERGED")
  return (head && rest.find((node) => node.headRefOid === head)) || rest.at(0)
}

/** Candidates that can belong to this checkout: same-repo PRs, or fork PRs proven by the local HEAD SHA. */
export function own(nodes: BatchNode[], head?: string): BatchNode[] {
  return nodes.filter((node) => node.isCrossRepository === false || (head !== undefined && node.headRefOid === head))
}

/** Match the rich-to-base degradation messages used by PRStatusPoller.query. */
export function unknown(message: string): boolean {
  return /unknown.*field|does(?:n't| not) exist|not accessible|insufficient|forbidden/i.test(message)
}

function aliasIndex(alias: string, total: number): number {
  const match = /^[bc](\d+)$/.exec(alias)
  if (!match) return -1
  const index = Number(match[1])
  return index < total ? index : -1
}

function selection(value: unknown): unknown[] | undefined {
  if (!value || typeof value !== "object") return undefined
  const list = (value as { nodes?: unknown }).nodes
  return Array.isArray(list) ? list : undefined
}

/** Flatten commits[0].commit.statusCheckRollup.contexts.nodes into a gh-style list. */
function flatten(node: BatchNode): unknown[] | undefined {
  const commits = selection(node.commits)
  const first = commits?.at(0) as { commit?: { statusCheckRollup?: { contexts?: unknown } } } | undefined
  const contexts = selection(first?.commit?.statusCheckRollup?.contexts)
  if (!contexts) return undefined
  return contexts.map((item) => {
    const check = item as Record<string, unknown>
    if (check.__typename !== "CheckRun") return check
    const suite = check.checkSuite as { workflowRun?: { workflow?: { name?: unknown } } } | undefined
    const rest = { ...check }
    delete rest.checkSuite
    return { ...rest, workflowName: suite?.workflowRun?.workflow?.name }
  })
}

function aliasNodes(value: unknown): BatchNode[] {
  if (!value || typeof value !== "object") return []
  const record = value as Record<string, unknown>
  if (Array.isArray(record.nodes)) return record.nodes as BatchNode[]
  const associated = record.associatedPullRequests
  if (associated && typeof associated === "object") {
    const list = (associated as { nodes?: unknown }).nodes
    if (Array.isArray(list)) return list as BatchNode[]
  }
  return []
}

/**
 * Merge the branch-name alias with the HEAD-SHA alias. A commit is associated
 * with every PR that contains it, including the squash-merge commit of the last
 * merged PR that a fresh branch off main starts from. Like the legacy
 * `gh pr list --search <sha> --state open` fallback, a SHA candidate therefore
 * only counts when it is open and its head is exactly the local HEAD.
 */
function merge(repo: Record<string, unknown> | undefined, index: number, head: string | undefined): BatchNode[] {
  const nodes = new Map<number, BatchNode>()
  const add = (node: BatchNode) => {
    if (typeof node.number !== "number" || typeof node.state !== "string") return
    if (!nodes.has(node.number)) nodes.set(node.number, node)
  }
  for (const node of aliasNodes(repo?.[`b${index}`])) add(node)
  for (const node of aliasNodes(repo?.[`c${index}`])) {
    if (head !== undefined && node.headRefOid === head && node.state === "OPEN") add(node)
  }
  return [...nodes.values()]
}
