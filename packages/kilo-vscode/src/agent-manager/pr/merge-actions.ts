import type { PRMergeRequest, PRMergeResult } from "../../shared/pr-comment-actions"
import { oid } from "../../shared/pr-comment-preview"
import { execGhRead } from "../gh"
import { ghErrorReason } from "./am-pr-utils"
import type { PRReviewContext, PRReviewHost } from "./review-context"

type Method = "merge" | "squash" | "rebase"

function request(message: Record<string, unknown>): PRMergeRequest | undefined {
  const base = {
    projectId: typeof message.projectId === "string" ? message.projectId : undefined,
    worktreeId: typeof message.worktreeId === "string" ? message.worktreeId : "",
    requestId: typeof message.requestId === "string" ? message.requestId : "",
    prNumber: typeof message.prNumber === "number" ? message.prNumber : 0,
    prUrl: typeof message.prUrl === "string" ? message.prUrl : "",
  }
  if (!base.worktreeId || !base.requestId || !base.prNumber || !base.prUrl) return undefined
  if (message.type === "agentManager.updatePRBranch" && typeof message.head === "string")
    return { ...base, type: message.type, head: message.head }
  if (
    message.type === "agentManager.mergePR" &&
    method(message.method) &&
    typeof message.auto === "boolean" &&
    typeof message.head === "string"
  )
    return { ...base, type: message.type, method: message.method, auto: message.auto, head: message.head }
  if (message.type === "agentManager.disablePRAutoMerge") return { ...base, type: message.type }
  if (message.type === "agentManager.loadPRConflicts" && oid(message.base) && oid(message.head))
    return { ...base, type: message.type, base: message.base, head: message.head }
  return undefined
}

function method(value: unknown): value is Method {
  return value === "merge" || value === "squash" || value === "rebase"
}

function flag(value: Method): "--merge" | "--squash" | "--rebase" {
  if (value === "merge") return "--merge"
  if (value === "rebase") return "--rebase"
  return "--squash"
}

function endpoint(context: PRReviewContext): string {
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
  )
    throw new Error("Unsupported pull request URL.")
  if (!/^[\w.-]+$/.test(match[1]!) || !/^[\w.-]+$/.test(match[2]!)) throw new Error("Invalid repository.")
  return `repos/${match[1]}/${match[2]}/pulls/${context.pr.number}`
}

function result(request: PRMergeRequest, success: boolean, error?: string): PRMergeResult {
  return {
    type:
      request.type === "agentManager.updatePRBranch"
        ? "agentManager.updatePRBranchResult"
        : request.type === "agentManager.mergePR"
          ? "agentManager.mergePRResult"
          : request.type === "agentManager.loadPRConflicts"
            ? "agentManager.loadPRConflictsResult"
            : "agentManager.disablePRAutoMergeResult",
    projectId: request.projectId,
    worktreeId: request.worktreeId,
    requestId: request.requestId,
    prNumber: request.prNumber,
    prUrl: request.prUrl,
    success,
    ...(error ? { error } : {}),
  }
}

export class PRMergeActions {
  private readonly pending = new Set<string>()

  constructor(private readonly host: PRReviewHost) {}

  handle(message: Record<string, unknown>): boolean {
    if (
      message.type !== "agentManager.updatePRBranch" &&
      message.type !== "agentManager.mergePR" &&
      message.type !== "agentManager.disablePRAutoMerge" &&
      message.type !== "agentManager.loadPRConflicts"
    )
      return false
    void this.run(message)
    return true
  }

  private async run(message: Record<string, unknown>): Promise<void> {
    const initial = request(message)
    const resultType =
      message.type === "agentManager.updatePRBranch"
        ? "agentManager.updatePRBranchResult"
        : message.type === "agentManager.mergePR"
          ? "agentManager.mergePRResult"
          : message.type === "agentManager.loadPRConflicts"
            ? "agentManager.loadPRConflictsResult"
            : "agentManager.disablePRAutoMergeResult"
    const fallback = {
      type: resultType,
      projectId: typeof message.projectId === "string" ? message.projectId : undefined,
      worktreeId: typeof message.worktreeId === "string" ? message.worktreeId : "",
      requestId: typeof message.requestId === "string" ? message.requestId : "",
      prNumber: typeof message.prNumber === "number" ? message.prNumber : 0,
      prUrl: typeof message.prUrl === "string" ? message.prUrl : "",
    } as Omit<PRMergeResult, "success">
    const key = JSON.stringify([fallback.projectId, fallback.worktreeId, fallback.type])
    if (this.pending.has(key)) {
      this.host.post({
        ...fallback,
        success: false,
        error: "Another pull request action is already running.",
      } as PRMergeResult)
      return
    }
    this.pending.add(key)
    try {
      if (!initial) throw new Error("Invalid pull request merge request.")
      const context = this.host.context(message)
      if (initial.type !== "agentManager.disablePRAutoMerge" && initial.head !== context.pr.headRefOid)
        throw new Error("Pull request changed. Refresh and try again.")
      if (
        initial.type === "agentManager.loadPRConflicts" &&
        (initial.base !== context.pr.baseRefOid || initial.head !== context.pr.headRefOid)
      )
        throw new Error("Pull request changed. Refresh and try again.")
      if (context.pr.state !== "open") throw new Error("The pull request is no longer open.")
      const extra = await this.execute(initial, context)
      this.host.post({ ...result(initial, true), ...extra } as PRMergeResult)
      if (initial.type !== "agentManager.loadPRConflicts") this.refresh(context, true)
    } catch (error) {
      const reason = error instanceof Error ? ghErrorReason(error.message) : String(error)
      this.host.post({ ...fallback, success: false, error: reason } as PRMergeResult)
    } finally {
      this.pending.delete(key)
    }
  }

  private async execute(request: PRMergeRequest, context: PRReviewContext): Promise<Partial<PRMergeResult>> {
    if (request.type === "agentManager.loadPRConflicts") {
      const files = (await this.host.conflicts?.(context, request.base, request.head)) ?? []
      return { files } as Partial<PRMergeResult>
    }
    const path = endpoint(context)
    if (request.type === "agentManager.updatePRBranch") {
      await execGhRead(
        [
          "api",
          "--hostname",
          "github.com",
          "--method",
          "PUT",
          `${path}/update-branch`,
          "-f",
          `expected_head_sha=${request.head}`,
        ],
        { cwd: context.directory, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
      )
      return {}
    }
    if (request.type === "agentManager.disablePRAutoMerge") {
      await execGhRead(["pr", "merge", context.pr.url, "--disable-auto"], {
        cwd: context.directory,
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
      })
      return {}
    }
    await execGhRead(
      [
        "pr",
        "merge",
        context.pr.url,
        flag(request.method),
        "--match-head-commit",
        request.head,
        ...(request.auto ? ["--auto"] : []),
      ],
      { cwd: context.directory, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
    )
    const repo = new URL(context.pr.url).pathname.split("/").slice(1, 3).join("/")
    await this.save(repo, request.method)
    return {}
  }

  private async save(repo: string, method: Method): Promise<void> {
    const save = this.host.savePRMergeMethod
    if (!save) return
    await save(repo, method).catch((error) => console.error("[Kilo New] Failed to save PR merge method", error))
  }

  private refresh(context: PRReviewContext, settle = false): void {
    try {
      this.host.refresh(context, settle)
    } catch (error) {
      console.error("[Kilo New] Failed to refresh pull request after merge action", error)
    }
  }
}
