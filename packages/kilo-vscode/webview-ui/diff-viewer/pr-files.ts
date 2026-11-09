// The PR files the Changes tab shows in PR mode. A ref-only refresh (a push or rebase) keeps the previous snapshot
// until the new one loads, because an empty diff list would make the review controller drop unsent comments. A failed
// load forgets its key, so the next poll or click asks again instead of keeping the stale snapshot for good.
import { createSignal } from "solid-js"
import type { PRDiffSnapshot, PRTarget } from "../../src/shared/pr-comment-actions"
import { reviewRequest } from "../agent-manager/pr/pr-review-request"

/** Compares only the PR identity. Ref-only refreshes must not clear local comments. */
export function samePR(a: PRTarget | undefined, b: PRTarget | undefined) {
  return a?.projectId === b?.projectId && a?.prNumber === b?.prNumber && a?.prUrl === b?.prUrl
}

export function createPRFiles(opts: { post: (message: never) => void; failed: () => string }) {
  const [snapshot, setSnapshot] = createSignal<PRDiffSnapshot>()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string>()
  let key = ""
  let requestId = ""
  // The PR the current snapshot or request belongs to.
  let target: PRTarget | undefined

  const reset = () => {
    key = ""
    requestId = ""
    target = undefined
    setSnapshot(undefined)
    setLoading(false)
    setError(undefined)
  }

  const request = (next: PRTarget | undefined) => {
    if (!next) return reset()
    const id = JSON.stringify(next)
    if (key === id && (loading() || snapshot())) return
    const refresh = samePR(target, next)
    key = id
    target = next
    const current = crypto.randomUUID()
    requestId = current
    if (!refresh) setSnapshot(undefined)
    setLoading(true)
    setError(undefined)
    reviewRequest({ ...next, type: "agentManager.loadPRFiles", requestId: current }, opts.post, (result) => {
      if (key !== id || requestId !== current) return
      if (result.type !== "agentManager.loadPRFilesResult") return
      setLoading(false)
      if (result.success && result.snapshot) return setSnapshot(result.snapshot)
      // Forget the key, so a later request for the same refs retries instead of returning on the kept snapshot.
      key = ""
      setError(result.error || opts.failed())
    })
  }

  return { snapshot, loading, error, request, reset, clearError: () => setError(undefined) }
}
