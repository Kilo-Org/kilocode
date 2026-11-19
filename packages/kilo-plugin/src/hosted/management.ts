import type { KiloAccount } from "@kilocode/gateway-core"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { HostedManagement } from "@opencode/schema/kilocode/hosted-management"
import { Schema } from "effect"
import { HostedError, invalid } from "./error"
import { json, responseError } from "./transport"

const nullable = Schema.NullOr(Schema.String)
const Metadata = Schema.Struct({
  session_id: Schema.String,
  cloud_agent_session_id: nullable,
  cloud_agent_worktree_id: nullable,
  organization_id: nullable,
  title: nullable,
  git_branch: nullable,
  total_cost_microdollars: HostedManagement.Info.fields.totalCostMicrodollars,
  runtimeState: Schema.NullOr(Schema.Struct({ model: Schema.optional(nullable), mode: Schema.optional(nullable) })),
})
const ResponseData = Schema.Struct({ result: Schema.Struct({ data: Schema.Unknown }) })
const Refusal = Schema.Struct({ error: Schema.Struct({ message: Schema.String }) })
const Removed = Schema.Struct({
  workspaceId: Schema.String,
  sessionId: Schema.String,
  success: Schema.Literal(true),
  cleanup: Schema.optional(HostedManagement.Deleted.fields.cleanup),
})

export function createManagement(
  account: KiloAccount.Info,
  issuer: string,
  authorize: (target: KiloHostedRpc.Target, signal: AbortSignal) => Promise<string>,
  worker: (path: string, init: RequestInit) => Promise<Response>,
) {
  async function data(response: Response) {
    if (!response.ok) return responseError(response)
    const envelope = await json(response, 2 * 1024 * 1024)
    if (!Schema.is(ResponseData)(envelope)) return invalid()
    return envelope.result.data
  }

  async function web(method: "rename" | "getWithRuntimeState", input: object, signal: AbortSignal) {
    const body = JSON.stringify(input)
    const read = method === "getWithRuntimeState"
    const url = new URL(`/api/trpc/cliSessionsV2.${method}`, issuer)
    if (read) url.searchParams.set("input", body)
    return data(
      await fetch(url, {
        method: read ? "GET" : "POST",
        ...(read ? {} : { body }),
        redirect: "error",
        credentials: "omit",
        headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      }),
    )
  }
  return {
    async info(target: KiloHostedRpc.Target, signal: AbortSignal): Promise<HostedManagement.Info> {
      const control = await authorize(target, signal)
      const result = await web("getWithRuntimeState", { session_id: target.sessionID }, signal)
      if (
        !Schema.is(Metadata)(result) ||
        result.session_id !== target.sessionID ||
        result.cloud_agent_session_id !== control ||
        result.cloud_agent_worktree_id !== target.workspaceID ||
        result.organization_id !== account.organizationID
      )
        return invalid()
      return {
        title: result.title,
        branch: result.git_branch,
        ...(result.runtimeState?.model && { model: result.runtimeState.model }),
        ...(result.runtimeState?.mode && { agent: result.runtimeState.mode }),
        totalCostMicrodollars: result.total_cost_microdollars,
      }
    },
    async rename(target: KiloHostedRpc.Target, title: string, signal: AbortSignal) {
      await authorize(target, signal)
      const trimmed = title.trim()
      const ack = await web("rename", { session_id: target.sessionID, title: trimmed }, signal)
      if (!Schema.is(Schema.Struct({ title: Schema.String }))(ack) || ack.title !== trimmed) return invalid()
      return { title: ack.title }
    },
    async remove(target: KiloHostedRpc.Target, operationKey: string, signal: AbortSignal) {
      const control = await authorize(target, signal)
      const response = await worker("/trpc/deleteHostedWorkspaceSession", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        body: JSON.stringify({ workspaceId: target.workspaceID, sessionId: control, operationKey }),
      })
      if (response.status === 409) {
        const error = await json(response, 64 * 1024).catch(() => undefined)
        if (Schema.is(Refusal)(error) && error.error.message === "workspace_requires_root_session")
          throw new HostedError("Cloud requires at least one session in this workspace. The session was not deleted.")
        throw new HostedError("Cloud could not confirm session deletion. Refresh the workspace before trying again.")
      }
      const ack = await data(response)
      if (!Schema.is(Removed)(ack) || ack.workspaceId !== target.workspaceID || ack.sessionId !== control)
        return invalid()
      return { cleanup: ack.cleanup ?? ("complete" as const) }
    },
  }
}
