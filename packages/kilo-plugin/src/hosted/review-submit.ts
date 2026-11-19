import type { KiloAccount } from "@kilocode/gateway-core"
import { createHash } from "node:crypto"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import type { HostedReview } from "@opencode/schema/kilocode/hosted-review"
import { Schema } from "effect"
import type { createCatalog } from "./catalog"
import type { createReview } from "./review"
import { verifiedPrompt } from "./review-anchors"
import { invalid } from "./error"
import { json, responseError } from "./transport"

const maybe = Schema.NullOr(Schema.String),
  opt = Schema.optional(Schema.String)
const row = {
  session_id: Schema.String,
  cloud_agent_worktree_id: maybe,
  cloud_agent_session_id: maybe,
  organization_id: maybe,
  created_on_platform: Schema.String,
}
const Page = Schema.Struct({
  cliSessions: Schema.Array(Schema.Struct({ ...row, title: maybe, parent_session_id: maybe })).check(
    Schema.isMaxLength(200),
  ),
})
const Session = Schema.Struct({
  ...row,
  runtimeState: Schema.Struct({
    sessionId: Schema.String,
    kiloSessionId: Schema.String,
    userId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
    orgId: opt,
    model: opt,
    mode: opt,
    variant: opt,
    runtimeAgents: Schema.optional(Schema.Array(Schema.Struct({ slug: Schema.String, model: opt, variant: opt }))),
  }),
})
const Envelope = Schema.Struct({ result: Schema.Struct({ data: Schema.Unknown }) })
const receipt = { cloudAgentSessionId: Schema.String, messageId: Schema.String }
const Ack = Schema.Struct({ ...receipt, delivery: Schema.Literals(["sent", "queued"]) })
const Found = Schema.Struct({
  ...receipt,
  status: Schema.Literals(["queued", "running", "completed", "failed", "interrupted"]),
})
const modes = new Set(["code", "plan", "debug", "orchestrator", "ask"])
type Input = { target: KiloHostedRpc.Target; destinationID: string; messageID: string }

class Rejected extends Error {}

function configuration(r: typeof Session.Type.runtimeState) {
  const mode = r.mode === "build" ? "code" : r.mode === "architect" ? "plan" : r.mode
  const pinned = r.runtimeAgents?.find((a) => a.slug === mode)
  if (!mode || (!modes.has(mode) && !pinned)) return
  const model = pinned?.model?.trim() || r.model,
    variant = pinned?.model?.trim() ? pinned.variant : r.variant
  if (model?.trim()) return { mode, model, variant }
}

export function createReviewSubmit(
  account: KiloAccount.Info,
  issuer: string,
  catalog: Pick<ReturnType<typeof createCatalog>, "authorize" | "workspace">,
  reader: ReturnType<typeof createReview>,
) {
  const org = account.organizationID,
    prefix = `${org ? "organizations." : ""}cloudAgentNext.`
  async function call(procedure: string, input: object, signal: AbortSignal, post = false) {
    const url = new URL(`/api/trpc/${procedure}`, issuer),
      body = JSON.stringify(input)
    if (!post) url.searchParams.set("input", body)
    const response = await fetch(url, {
      method: post ? "POST" : "GET",
      ...(post && { body }),
      headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    })
    if (post && [400, 401, 402, 403, 404, 409, 412, 422, 429].includes(response.status)) {
      void response.body?.cancel()
      throw new Rejected()
    }
    if (!response.ok) return responseError(response)
    const result = await json(response, 2 * 1024 * 1024)
    if (!Schema.is(Envelope)(result)) return invalid()
    return result.result.data
  }

  async function roots(target: KiloHostedRpc.Target, signal: AbortSignal) {
    const source = await catalog.authorize(target, signal)
    const page = await call(
      "cliSessionsV2.list",
      { organizationId: org, worktreeId: target.workspaceID, limit: 200, orderBy: "updated_at" },
      signal,
    )
    if (!Schema.is(Page)(page)) return invalid()
    const eligible = page.cliSessions.filter(
      (r) =>
        r.created_on_platform === "cloud-agent-web" &&
        r.parent_session_id === null &&
        r.organization_id === org &&
        r.cloud_agent_worktree_id === target.workspaceID &&
        r.cloud_agent_session_id?.startsWith("workspace_"),
    )
    if (!eligible.some((r) => r.session_id === target.sessionID && r.cloud_agent_session_id === source)) return []
    return eligible
  }
  async function destinations(target: KiloHostedRpc.Target, signal: AbortSignal) {
    const eligible = await roots(target, signal)
    if (!eligible.length) return { items: [] }
    const visible = new Set<string>()
    let cursor: string | undefined
    for (let i = 0; i < 20; i++) {
      const page = await catalog.workspace({ workspaceID: target.workspaceID, cursor }, signal)
      for (const session of page.sessions) visible.add(session.sessionID)
      cursor = page.cursor
      if (!cursor) break
    }
    const source = eligible.find((r) => r.session_id === target.sessionID)?.cloud_agent_session_id
    const owner = source && visible.has(target.sessionID) && (await runtime(target, source, signal))
    return {
      ...(owner && {
        draftKey: createHash("sha256")
          .update(JSON.stringify([issuer, owner.userId, org, target.workspaceID, target.sessionID]))
          .digest("hex"),
      }),
      items: eligible
        .filter((r) => visible.has(r.session_id))
        .map((r) => ({ sessionID: r.session_id, title: r.title?.trim() || r.session_id })),
    }
  }
  async function runtime(target: KiloHostedRpc.Target, control: string, signal: AbortSignal) {
    const result = await call("cliSessionsV2.getWithRuntimeState", { session_id: target.sessionID }, signal)
    if (
      !Schema.is(Session)(result) ||
      result.created_on_platform !== "cloud-agent-web" ||
      result.organization_id !== org ||
      result.session_id !== target.sessionID ||
      result.cloud_agent_worktree_id !== target.workspaceID ||
      result.cloud_agent_session_id !== control
    )
      return invalid()
    const r = result.runtimeState
    if (r.sessionId !== control || r.kiloSessionId !== target.sessionID || r.orgId !== (org ?? undefined))
      return invalid()
    return r
  }
  const scoped = (i: Input, control: string) => ({
    cloudAgentSessionId: control,
    messageId: i.messageID,
    expectedWorktreeId: i.target.workspaceID,
    ...(org && { organizationId: org }),
  })
  async function check(i: Input, control: string, signal: AbortSignal): Promise<HostedReview.Delivery> {
    const result = await call(prefix + "getMessageResult", scoped(i, control), signal)
    return {
      status:
        Schema.is(Found)(result) && result.cloudAgentSessionId === control && result.messageId === i.messageID
          ? "accepted"
          : "unknown",
    }
  }
  async function prepare(i: Input & { draft: HostedReview.Draft }, signal: AbortSignal) {
    const rows = await roots(i.target, signal),
      dest = { ...i.target, sessionID: i.destinationID }
    const control = await catalog.authorize(dest, signal),
      source = rows.find((r) => r.session_id === i.target.sessionID)?.cloud_agent_session_id
    if (!source || !rows.some((r) => r.session_id === i.destinationID && r.cloud_agent_session_id === control)) return
    const r = await runtime(dest, control, signal),
      from = source === control ? r : await runtime(i.target, source, signal)
    if (r.userId !== from.userId) return
    const agent = configuration(r)
    if (!agent) return
    const { snapshot } = await reader.changes({ target: i.target }, signal)
    const prompt = await verifiedPrompt(
      i.draft,
      snapshot,
      {
        userId: from.userId,
        organizationId: org ?? undefined,
        workspaceScope: `worktree:${i.target.workspaceID}`,
        sourceCloudAgentSessionId: source,
      },
      (c) => reader.file({ target: i.target, selection: c }, signal),
    )
    if (!prompt) return
    return { control, payload: { type: "prompt", prompt, ...agent } }
  }
  return {
    destinations,
    async delivery(i: Input, signal: AbortSignal) {
      await catalog.authorize(i.target, signal)
      return check(i, await catalog.authorize({ ...i.target, sessionID: i.destinationID }, signal), signal)
    },
    async send(i: Input & { draft: HostedReview.Draft }, signal: AbortSignal): Promise<HostedReview.Delivery> {
      const prepared = await prepare(i, signal).catch(() => undefined)
      if (!prepared) return { status: "unverified" }
      const { control, payload } = prepared
      try {
        const ack = await call(
          prefix + "sendMessage",
          { ...scoped(i, control), autoCommit: true, payload },
          signal,
          true,
        )
        if (Schema.is(Ack)(ack) && ack.cloudAgentSessionId === control && ack.messageId === i.messageID)
          return { status: "accepted" }
      } catch (error) {
        if (error instanceof Rejected) return { status: "rejected" }
      }
      // The POST might have committed. Only read the durable result; don't create a second turn.
      return check(i, control, signal).catch(() => ({ status: "unknown" }))
    },
  }
}
