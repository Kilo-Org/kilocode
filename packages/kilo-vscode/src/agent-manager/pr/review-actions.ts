import { randomUUID } from "node:crypto"
import type { PRDiffSnapshot, PRReviewResult } from "../../shared/pr-comment-actions"
import { execGhRead } from "../gh"
import { execGhInput } from "./PRActions"
import type { PRReviewContext, PRReviewHost } from "./review-context"
import { parsePatch } from "../../shared/pr-patch"

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid GitHub response.")
  return value as Record<string, unknown>
}

function identity(context: PRReviewContext) {
  return JSON.stringify([
    context.projectId,
    context.worktreeId,
    context.directory,
    context.branch,
    context.pr.number,
    context.pr.url,
  ])
}

function endpoint(context: PRReviewContext) {
  const url = new URL(context.pr.url)
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(url.pathname)
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !match ||
    Number(match[3]) !== context.pr.number
  ) {
    throw new Error("Unsupported pull request URL.")
  }
  if (!/^[\w.-]+$/.test(match[1]!) || !/^[\w.-]+$/.test(match[2]!)) throw new Error("Invalid repository.")
  return `repos/${match[1]}/${match[2]}/pulls/${context.pr.number}`
}

async function api(context: PRReviewContext, path: string, fields: string[] = [], input?: Record<string, unknown>) {
  const opts = {
    cwd: context.directory,
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  }
  const method = fields.length || input !== undefined ? "POST" : "GET"
  const args = ["api", "--hostname", "github.com", "--method", method, path]
  const { stdout } =
    input === undefined ? await execGhRead([...args, ...fields], opts) : await execGhInput(args, input, opts)
  return JSON.parse(stdout) as unknown
}

async function metadata(context: PRReviewContext) {
  const data = object(await api(context, endpoint(context)))
  const head = object(data.head).sha
  const base = object(data.base).sha
  if (
    data.number !== context.pr.number ||
    data.html_url !== context.pr.url ||
    typeof head !== "string" ||
    !/^[a-f0-9]{40}$/.test(head) ||
    typeof base !== "string" ||
    !/^[a-f0-9]{40}$/.test(base) ||
    !Number.isSafeInteger(data.changed_files) ||
    Number(data.changed_files) < 0
  ) {
    throw new Error("Invalid pull request metadata.")
  }
  if (data.state !== "open" || data.merged === true) throw new Error("The pull request is no longer open.")
  return { head, base, count: Number(data.changed_files) }
}

type Snapshot = { identity: string; data: PRDiffSnapshot; base: string }

function selection(snapshot: Snapshot, message: Record<string, unknown>) {
  const file = snapshot.data.files.find((file) => file.path === message.path)
  const start = message.startLine
  const end = message.endLine
  if (
    !file?.patch ||
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1 ||
    end < start ||
    (message.side !== "LEFT" && message.side !== "RIGHT")
  )
    throw new Error("Invalid review line range.")
  const allowed = parsePatch(file.patch)?.ranges
  if (!allowed?.some((range) => range.side === message.side && start >= range.start && end <= range.end))
    throw new Error("Selected lines are not in a complete review hunk.")
  const body = message.body as string
  if (!body.trim()) throw new Error("A review comment body is required.")
  if (message.side !== "RIGHT" && /(?:^|\n) {0,3}(?:`{3,}|~{3,})[ \t]*suggestion\b/.test(body))
    throw new Error("Suggestions require RIGHT-side lines.")
  return { file, start, end, body }
}

function parse(value: unknown) {
  const file = object(value)
  if (typeof file.filename !== "string" || !file.filename || typeof file.status !== "string")
    throw new Error("Invalid GitHub file metadata.")
  const patch =
    typeof file.patch === "string" && parsePatch(file.patch, { additions: file.additions, deletions: file.deletions })
      ? file.patch
      : undefined
  return {
    path: file.filename,
    status: file.status,
    previousPath: typeof file.previous_filename === "string" ? file.previous_filename : undefined,
    patch,
  }
}

export class PRReviewActions {
  private readonly snapshots = new Map<string, Snapshot>()
  private readonly pending = new Set<string>()

  constructor(private readonly host: PRReviewHost) {}

  handle(message: Record<string, unknown>): boolean {
    if (
      message.type !== "agentManager.loadPRFiles" &&
      message.type !== "agentManager.createReviewComment" &&
      message.type !== "agentManager.submitPRReview"
    )
      return false
    void this.run(message)
    return true
  }

  private async run(message: Record<string, unknown>) {
    const result = {
      type: `${message.type}Result`,
      requestId: typeof message.requestId === "string" ? message.requestId : "",
      projectId: typeof message.projectId === "string" ? message.projectId : undefined,
      worktreeId: typeof message.worktreeId === "string" ? message.worktreeId : "",
      prNumber: typeof message.prNumber === "number" ? message.prNumber : 0,
      prUrl: typeof message.prUrl === "string" ? message.prUrl : "",
    } as Omit<PRReviewResult, "success">
    const key = JSON.stringify([result.projectId, result.worktreeId, result.requestId])
    if (this.pending.has(key)) return
    this.pending.add(key)
    try {
      if (!result.requestId) throw new Error("Missing request identity.")
      const initial = this.host.context(message)
      const context = { ...initial, pr: { ...initial.pr } }
      if (message.type === "agentManager.loadPRFiles") {
        const snapshot = await this.load(context, message)
        this.host.post({ ...result, type: "agentManager.loadPRFilesResult", success: true, snapshot })
        return
      }
      if (typeof message.body !== "string") throw new Error("Invalid review body.")
      if (message.type === "agentManager.createReviewComment") await this.comment(context, message)
      else await this.submit(context, message)
      this.host.post({ ...result, success: true } as PRReviewResult)
      this.refresh(context)
    } catch (error) {
      this.host.post({
        ...result,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      } as PRReviewResult)
    } finally {
      this.pending.delete(key)
    }
  }

  private refresh(context: PRReviewContext) {
    try {
      this.host.refresh(context)
    } catch (error) {
      // A refresh failure must not report an already-confirmed write as failed.
      console.error("[Kilo New] Failed to refresh pull request after review action", error)
    }
  }

  private current(context: PRReviewContext, message: Record<string, unknown>) {
    if (identity(this.host.context(message)) !== identity(context))
      throw new Error("Pull request context changed. Reload the review.")
  }

  private async load(context: PRReviewContext, message: Record<string, unknown>) {
    const before = await metadata(context)
    if (before.count > 3000)
      throw new Error("GitHub limits pull request files to 3000. This review cannot be loaded safely.")
    const files: PRDiffSnapshot["files"] = []
    let size = 0
    for (let page = 1; page <= Math.max(1, Math.ceil(before.count / 100)); page++) {
      const data = await api(context, `${endpoint(context)}/files?per_page=100&page=${page}`)
      if (!Array.isArray(data) || data.length > 100) throw new Error("Invalid GitHub file response.")
      for (const value of data) {
        const file = parse(value)
        if (files.some((entry) => entry.path === file.path)) throw new Error("Duplicate GitHub file metadata.")
        size += file.path.length + file.status.length + (file.previousPath?.length ?? 0) + (file.patch?.length ?? 0)
        if (size > 4 * 1024 * 1024) throw new Error("Pull request diff is too large to review safely here.")
        files.push(file)
      }
    }
    const after = await metadata(context)
    this.current(context, message)
    if (
      before.head !== after.head ||
      before.base !== after.base ||
      before.count !== after.count ||
      files.length !== before.count
    )
      throw new Error("Pull request changed while loading. Reload the review.")
    const data = { id: randomUUID(), head: before.head, files }
    // Keep at most eight bounded snapshots. Evicted views must reload before posting.
    if (this.snapshots.size >= 8) this.snapshots.delete(this.snapshots.keys().next().value!)
    this.snapshots.set(data.id, { identity: identity(context), data, base: before.base })
    return data
  }

  private snapshot(context: PRReviewContext, message: Record<string, unknown>) {
    const snapshot = typeof message.snapshotId === "string" ? this.snapshots.get(message.snapshotId) : undefined
    if (!snapshot || snapshot.identity !== identity(context))
      throw new Error("Review snapshot expired or belongs to another pull request. Reload the review.")
    return snapshot
  }

  private async comment(context: PRReviewContext, message: Record<string, unknown>) {
    const snapshot = this.snapshot(context, message)
    const { file, start, end, body } = selection(snapshot, message)
    const fresh = await metadata(context)
    this.current(context, message)
    if (fresh.head !== snapshot.data.head || fresh.base !== snapshot.base)
      throw new Error("Pull request changed. Reload the review before posting.")
    const input = {
      body,
      commit_id: snapshot.data.head,
      path: file.path,
      side: message.side,
      line: end,
      ...(start !== end ? { start_line: start, start_side: message.side } : {}),
    }
    const data = object(await api(context, `${endpoint(context)}/comments`, [], input))
    if (
      !Number.isSafeInteger(data.id) ||
      Number(data.id) <= 0 ||
      data.commit_id !== snapshot.data.head ||
      data.path !== file.path ||
      data.line !== end ||
      data.side !== message.side ||
      (start !== end && (data.start_line !== start || data.start_side !== message.side))
    )
      throw new Error("GitHub did not confirm the review comment. Check the pull request before trying again.")
  }

  private async submit(context: PRReviewContext, message: Record<string, unknown>) {
    const event = message.event
    const body = message.body as string
    if (event !== "APPROVE" && event !== "REQUEST_CHANGES" && event !== "COMMENT")
      throw new Error("Invalid review event.")
    if (event !== "APPROVE" && !body.trim()) throw new Error("A body is required for this review.")
    const snapshot = this.snapshot(context, message)
    if (message.head !== snapshot.data.head)
      throw new Error("Pull request changed. Reload the review before submitting.")
    const fresh = await metadata(context)
    this.current(context, message)
    if (fresh.head !== snapshot.data.head || fresh.base !== snapshot.base)
      throw new Error("Pull request changed. Reload the review before submitting.")
    // GitHub enforces reviewer permissions, including the ban on approving your own PR.
    const data = object(
      await api(context, `${endpoint(context)}/reviews`, [], {
        body,
        commit_id: fresh.head,
        event,
      }),
    )
    const state = { APPROVE: "APPROVED", REQUEST_CHANGES: "CHANGES_REQUESTED", COMMENT: "COMMENTED" }[event]
    if (!Number.isSafeInteger(data.id) || Number(data.id) <= 0 || data.commit_id !== fresh.head || data.state !== state)
      throw new Error("GitHub did not confirm the review. Check the pull request before trying again.")
  }
}
