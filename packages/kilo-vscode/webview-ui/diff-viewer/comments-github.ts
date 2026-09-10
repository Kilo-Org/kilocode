import type { Accessor } from "solid-js"
import type { PRDiffSnapshot, PRTarget } from "../../src/shared/pr-comment-actions"
import { parsePatch } from "../../src/shared/pr-patch"
import type { WorktreeFileDiff } from "../src/types/messages"
import type { ReviewComment } from "./review-comments"
import { canCommentOnPRLine } from "./pr-diff"
import { reviewRequest } from "../agent-manager/pr/pr-review-request"

/** GitHub context for one local comment. `closed` marks a line outside the PR diff. */
export interface GithubContext {
  prNumber: number
  prUrl: string
  snapshotId: string
  label: string
  closed: boolean
}

export interface CommentsGithub {
  /** True when a PR with a loaded snapshot is available for publication. */
  available: () => boolean
  /** Resolve the GitHub target for a comment. `closed` means the line is not publishable. */
  resolve: (comment: ReviewComment) => GithubContext | undefined
  send: (comment: ReviewComment) => Promise<{ success: boolean; error?: string }>
}

function side(value: ReviewComment["side"]): "LEFT" | "RIGHT" {
  return value === "deletions" ? "LEFT" : "RIGHT"
}

/**
 * Resolve the GitHub review target for one line range.
 *
 * The line must exist in the PR snapshot and in a complete hunk of the patch.
 * A missing or incomplete patch returns a closed context so callers can disable
 * the action instead of hiding it.
 */
export function resolveGithubContext(opts: {
  target?: PRTarget
  snapshot?: PRDiffSnapshot
  file: string
  side: ReviewComment["side"]
  start: number
  end: number
  patch?: string
}): GithubContext | undefined {
  if (!opts.target || !opts.snapshot) return
  const mapped = side(opts.side)
  const allowed =
    !!opts.patch &&
    !!parsePatch(opts.patch, undefined, { side: mapped, start: opts.start, end: opts.end }) &&
    canCommentOnPRLine(opts.snapshot, opts.file, mapped, opts.start, opts.end)
  return {
    prNumber: opts.target.prNumber,
    prUrl: opts.target.prUrl,
    snapshotId: opts.snapshot.id,
    label: `GitHub #${opts.target.prNumber}`,
    closed: !allowed,
  }
}

interface Options {
  target: Accessor<PRTarget | undefined>
  snapshot: Accessor<PRDiffSnapshot | undefined>
  diffs: Accessor<WorktreeFileDiff[]>
  post: (message: never) => void
  /** Gate publication, for example when only local changes are shown. */
  canPublish?: Accessor<boolean>
}

export function createCommentsGithub(opts: Options): CommentsGithub {
  const resolve = (comment: ReviewComment) => {
    if (opts.canPublish?.() === false) return
    const diff = opts.diffs().find((item) => item.file === comment.file)
    return resolveGithubContext({
      target: opts.target(),
      snapshot: opts.snapshot(),
      file: comment.file,
      side: comment.side,
      start: comment.line,
      end: comment.line,
      patch: diff?.patch,
    })
  }

  const available = () => opts.canPublish?.() !== false && !!opts.target() && !!opts.snapshot()

  const send = (comment: ReviewComment) => {
    const { promise, resolve: settle } = Promise.withResolvers<{ success: boolean; error?: string }>()
    const target = opts.target()
    const context = resolve(comment)
    if (!target || !context || context.closed) {
      settle({ success: false })
      return promise
    }
    reviewRequest(
      {
        type: "agentManager.createReviewComment",
        projectId: target.projectId,
        worktreeId: target.worktreeId,
        prNumber: context.prNumber,
        prUrl: context.prUrl,
        requestId: crypto.randomUUID(),
        snapshotId: context.snapshotId,
        path: comment.file,
        side: side(comment.side),
        startLine: comment.line,
        endLine: comment.line,
        body: comment.comment,
      },
      opts.post,
      (result) => settle({ success: result.success, error: result.success ? undefined : result.error }),
    )
    return promise
  }

  return { available, resolve, send }
}

/**
 * Post comments one at a time and stop at the first failure.
 *
 * A failed request can still have reached GitHub, so callers must keep the
 * failed and unposted comments and surface the error instead of retrying.
 */
export async function postAllGithub(
  comments: ReviewComment[],
  github: CommentsGithub,
): Promise<{ posted: ReviewComment[]; failure?: string }> {
  const posted: ReviewComment[] = []
  for (const comment of comments) {
    const result = await github.send(comment)
    if (!result.success) return { posted, failure: result.error }
    posted.push(comment)
  }
  return { posted }
}
