import { Schema } from "effect"
import { createHash } from "node:crypto"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { HostedReview } from "@opencode/schema/kilocode/hosted-review"
import { invalid } from "./error"
import { json, responseError } from "./transport"

const Envelope = Schema.Struct({ result: Schema.Struct({ data: Schema.Unknown }) })
const Snapshot = Schema.NullOr(HostedReview.Snapshot)
const saved = Schema.Struct({ snapshot: Snapshot })
const refreshed = Schema.Struct({ status: Schema.Literals(["refreshed", "offline", "failed"]), snapshot: Snapshot })

export function createReview(
  authorize: (target: KiloHostedRpc.Target, signal: AbortSignal) => Promise<string>,
  request: (path: string, init: RequestInit) => Promise<Response>,
) {
  async function call(
    method: "getWorktreeChanges" | "getWorktreeFile" | "refreshWorktreeChanges",
    input: object,
    signal: AbortSignal,
  ) {
    const body = JSON.stringify(input)
    const mutation = method === "refreshWorktreeChanges"
    const path = `/trpc/${method}` + (mutation ? "" : `?${new URLSearchParams({ input: body })}`)
    const response = await request(path, {
      ...(mutation ? { method: "POST", headers: { "content-type": "application/json" }, body } : { method: "GET" }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    })
    if (!response.ok) return responseError(response)
    const envelope = await json(response, 2 * 1024 * 1024)
    if (!Schema.is(Envelope)(envelope)) return invalid()
    return envelope.result.data
  }

  return {
    async changes(
      input: { target: KiloHostedRpc.Target; refresh?: boolean },
      signal: AbortSignal,
    ): Promise<HostedReview.Changes> {
      const id = await authorize(input.target, signal)
      const raw = await call(
        input.refresh ? "refreshWorktreeChanges" : "getWorktreeChanges",
        { cloudAgentSessionId: id },
        signal,
      )
      // Decode (rather than cast) to omit Cloud-only metadata from the webview-facing DTO.
      if (input.refresh) {
        const result = Schema.decodeUnknownSync(refreshed)(raw)
        return { snapshot: result.snapshot, refresh: result.status }
      }
      return Schema.decodeUnknownSync(saved)(raw)
    },
    async file(
      input: { target: KiloHostedRpc.Target; selection: HostedReview.Selection },
      signal: AbortSignal,
    ): Promise<HostedReview.File> {
      const id = await authorize(input.target, signal)
      const s = input.selection
      const raw = await call(
        "getWorktreeFile",
        { cloudAgentSessionId: id, path: s.path, scope: s.scope, expectedRevision: s.revision },
        signal,
      )
      const result = Schema.decodeUnknownSync(HostedReview.File)(raw)
      if (
        "file" in result &&
        (result.file.path !== s.path ||
          result.file.scope !== s.scope ||
          result.file.revision !== s.revision ||
          result.file.diff.status !== result.status)
      )
        return invalid()
      if (result.status === "available" && result.file.diff.status === "available")
        return {
          ...result,
          file: { ...result.file, patchHash: createHash("sha256").update(result.file.diff.patch).digest("hex") },
        }
      return result
    },
  }
}
