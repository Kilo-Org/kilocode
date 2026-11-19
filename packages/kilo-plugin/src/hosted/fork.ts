import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { Schema } from "effect"
import { HostedError, invalid } from "./error"
import type { Authorize, Issuer } from "./fork-share"
import { repository } from "./repository"

const opt = Schema.optional(Schema.String)
const Runtime = Schema.Struct({
  sessionId: Schema.String,
  kiloSessionId: opt,
  worktreeId: Schema.optional(Schema.NullOr(Schema.String)),
  orgId: opt,
  platform: opt,
  githubRepo: opt,
  gitUrl: opt,
  model: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9._/:~-]{1,255}$/)),
  mode: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,49}$/)),
  variant: opt,
})
const Source = Schema.Struct({
  session_id: Schema.String,
  cloud_agent_session_id: Schema.String,
  cloud_agent_worktree_id: Schema.String,
  organization_id: Schema.NullOr(Schema.String),
  git_url: Schema.NullOr(Schema.String),
  runtimeState: Runtime,
})
const Result = Schema.Struct({
  workspaceId: Schema.String,
  activeKiloSessionId: Schema.String,
  sessions: Schema.Array(
    Schema.Struct({
      sourceKiloSessionId: Schema.String,
      kiloSessionId: Schema.String,
      cloudAgentSessionId: Schema.String,
    }),
  ),
  replayed: Schema.optional(Schema.Literal(true)),
})

const matches = (candidate: string, remote: string) => repository(candidate)?.toLowerCase() === remote.toLowerCase()

function forkRepository(runtime: typeof Runtime.Type, remote: string) {
  const url = new URL(remote)
  if (runtime.gitUrl && !matches(runtime.gitUrl, remote)) return invalid()
  const platform =
    runtime.platform ??
    (runtime.githubRepo || url.hostname === "github.com"
      ? "github"
      : url.hostname === "gitlab.com"
        ? "gitlab"
        : undefined)
  if (platform === "github" && url.hostname === "github.com") {
    const repo = url.pathname.slice(1)
    if (runtime.githubRepo ? runtime.githubRepo.toLowerCase() !== repo.toLowerCase() : !runtime.gitUrl) return invalid()
    return { type: "github", repo }
  }
  if (platform === "gitlab" && runtime.gitUrl) return { type: "gitlab", url: remote }
  throw new HostedError("This repository cannot be forked to Cloud.")
}

function sourcePayload(
  data: unknown,
  target: KiloHostedRpc.Target,
  control: string,
  org: string | null,
  remote: string,
) {
  if (
    !Schema.is(Source)(data) ||
    data.session_id !== target.sessionID ||
    data.cloud_agent_session_id !== control ||
    data.cloud_agent_worktree_id !== target.workspaceID ||
    data.organization_id !== org
  )
    return invalid()
  const runtime = data.runtimeState
  if (
    runtime.sessionId !== control ||
    (runtime.kiloSessionId && runtime.kiloSessionId !== target.sessionID) ||
    (runtime.worktreeId && runtime.worktreeId !== target.workspaceID) ||
    (runtime.orgId && runtime.orgId !== org) ||
    (data.git_url && !matches(data.git_url, remote))
  )
    return invalid()
  return {
    repository: forkRepository(runtime, remote),
    activeSourceKiloSessionId: target.sessionID,
    sessions: [
      {
        sourceKiloSessionId: target.sessionID,
        agent: {
          mode: runtime.mode,
          model: runtime.model,
          ...(runtime.variant && runtime.variant.length <= 50 && { variant: runtime.variant }),
        },
      },
    ],
  }
}

export function createFork(
  org: string | null,
  remote: string,
  authorize: Authorize,
  get: Issuer,
  submit: (body: string, signal: AbortSignal) => Promise<unknown>,
) {
  // The ledger hashes the whole request. Freeze the first request across ambiguous retries, including when the source agent changes.
  const attempts = new Map<string, { control: string; workspace: string; session: string; body: string }>()
  return async (target: KiloHostedRpc.Target, operationKey: string, signal: AbortSignal) => {
    const control = await authorize(target, signal)
    const previous = attempts.get(operationKey)
    if (
      previous &&
      (previous.control !== control ||
        previous.workspace !== target.workspaceID ||
        previous.session !== target.sessionID)
    )
      return invalid()
    const body =
      previous?.body ??
      JSON.stringify({
        operationKey,
        clientProvenance: "agent-manager",
        ...sourcePayload(
          await get("cliSessionsV2.getWithRuntimeState", { session_id: target.sessionID }, signal),
          target,
          control,
          org,
          remote,
        ),
      })
    // Never change an in-flight operation's payload or send a second intent with that key.
    const concurrent = attempts.get(operationKey)
    if (concurrent && concurrent.body !== body) return invalid()
    if (!concurrent && attempts.size >= 128) attempts.delete(attempts.keys().next().value!)
    attempts.set(operationKey, { control, workspace: target.workspaceID, session: target.sessionID, body })
    const result = await submit(body, signal)
    if (!Schema.is(Result)(result) || result.sessions.length !== 1) return invalid()
    const clone = result.sessions[0]!
    const destination = { ...target, workspaceID: result.workspaceId, sessionID: result.activeKiloSessionId }
    if (
      !Schema.is(KiloHostedRpc.Target)(destination) ||
      destination.workspaceID === target.workspaceID ||
      destination.sessionID === target.sessionID ||
      clone.sourceKiloSessionId !== target.sessionID ||
      clone.kiloSessionId !== destination.sessionID ||
      clone.cloudAgentSessionId === control
    )
      return invalid()
    if ((await authorize(destination, signal)) !== clone.cloudAgentSessionId) return invalid()
    return { target: destination, replayed: result.replayed === true }
  }
}
