import { createSignal, untrack, type Accessor } from "solid-js"
import type { PRDiffSnapshot, PRTarget } from "../../../src/shared/pr-comment-actions"
import type { PRStatus } from "../../src/types/messages"
import { reviewRequest } from "./pr-review-request"

interface Options {
  post: (message: never) => void
  project: Accessor<string | undefined>
  statuses: Accessor<Record<string, Pick<PRStatus, "number" | "url" | "baseRefOid" | "headRefOid"> | null>>
}

export function createPRDiffCommentState(opts: Options) {
  const [snapshots, setSnapshots] = createSignal<Record<string, PRDiffSnapshot>>({})
  const [pending, setPending] = createSignal(new Set<string>())
  const [errors, setErrors] = createSignal<Record<string, string>>({})

  const target = (ctx: string | undefined): PRTarget | undefined => {
    if (!ctx) return
    const pr = opts.statuses()[ctx]
    if (!pr) return
    return {
      projectId: opts.project(),
      worktreeId: ctx,
      prNumber: pr.number,
      prUrl: pr.url,
      baseRefOid: pr.baseRefOid,
      headRefOid: pr.headRefOid,
    }
  }

  const key = (ctx: string | undefined) => {
    const route = target(ctx)
    return route ? JSON.stringify(route) : ""
  }

  const snapshot = (ctx: string | undefined) => {
    const id = key(ctx)
    return id ? snapshots()[id] : undefined
  }

  const loading = (ctx: string | undefined) => pending().has(key(ctx))
  const error = (ctx: string | undefined) => errors()[key(ctx)]

  const load = (ctx: string | undefined) => {
    const route = target(ctx)
    if (!route) return
    const id = key(ctx)
    // Read the dedupe state untracked so a failed load does not re-trigger the
    // effect that called this, which would immediately retry forever.
    if (untrack(() => Boolean(snapshots()[id] || pending().has(id)))) return
    setPending((prev) => new Set(prev).add(id))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    reviewRequest(
      { ...route, type: "agentManager.loadPRFiles", requestId: crypto.randomUUID() },
      opts.post,
      (result) => {
        setPending((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        if (result.type !== "agentManager.loadPRFilesResult") return
        if (!result.success || !result.snapshot) {
          setErrors((prev) => ({ ...prev, [id]: result.error || "Could not load pull request changes." }))
          return
        }
        setSnapshots((prev) => ({ ...prev, [id]: result.snapshot! }))
      },
    )
  }

  return { target, snapshot, loading, error, load }
}
