import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { Schema } from "effect"
import { HostedError, HostedPreparing, invalid } from "./error"
import { repository, repositoryPayload } from "./repository"
import { json, responseError } from "./transport"

const id = KiloHostedRpc.Target.fields.workspaceID
const text = Schema.NullOr(Schema.String)
const cursor = Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)))
const Envelope = Schema.Struct({ result: Schema.Struct({ data: Schema.Unknown }) })
const Row = Schema.Struct({
  workspaceId: id,
  organizationId: text,
  gitUrl: text,
  gitBranch: text,
  name: text,
  deletionState: KiloHostedRpc.Workspace.fields.deletionState,
  nextSessionCursor: cursor,
  sessions: Schema.Array(
    Schema.Struct({ workspaceId: id, organizationId: text, kiloSessionId: id, cloudAgentSessionId: id, title: text }),
  ).check(Schema.isMaxLength(100)),
})
const Page = Schema.Struct({ items: Schema.Array(Row).check(Schema.isMaxLength(50)), nextCursor: cursor })
const Profile = Schema.Struct({ id, name: Schema.String, ownerType: Schema.Literals(["user", "organization"]) })
const Profiles = Schema.Struct({
  personalProfiles: Schema.Array(Profile),
  organizationProfiles: Schema.Array(Profile),
  effectiveDefaultProfileId: text,
})
const Created = Schema.Struct({
  workspaceId: id,
  kiloSessionId: id,
  messageId: Schema.optional(id),
  replayed: Schema.optional(Schema.Boolean),
})

export function createCatalog(
  scope: string,
  remote: string,
  org: string | null,
  request: (path: string, init: RequestInit) => Promise<Response>,
) {
  // A mutation receipt proves admission, not read access. Wait for the authorized catalog to catch up.
  const admitted = new Map<string, number>()
  const key = (workspace: string, session: string) => JSON.stringify([workspace, session])
  const procedure = async (name: string, input: object, signal: AbortSignal, mutation = false) => {
    const body = JSON.stringify(input)
    const response = await request(mutation ? `/trpc/${name}` : `/trpc/${name}?input=${encodeURIComponent(body)}`, {
      method: mutation ? "POST" : "GET",
      ...(mutation ? { headers: { "Content-Type": "application/json" }, body } : {}),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    })
    if (!response.ok) return responseError(response)
    const envelope = await json(response, 4 * 1024 * 1024)
    if (!Schema.is(Envelope)(envelope)) return invalid()
    return envelope.result.data
  }

  const sameRepository = (row: typeof Row.Type) =>
    row.gitUrl !== null && repository(row.gitUrl)?.toLowerCase() === remote.toLowerCase()
  const detail = async (input: { workspaceID: string; cursor?: string }, signal: AbortSignal) => {
    const row = await procedure(
      "getHostedWorkspace",
      { workspaceId: input.workspaceID, sessionCursor: input.cursor, sessionLimit: 100 },
      signal,
    )
    if (row === null) throw new HostedError("Cloud workspace was not found")
    if (!Schema.is(Row)(row)) return invalid()
    if (row.workspaceId !== input.workspaceID || row.organizationId !== org || !sameRepository(row)) {
      throw new HostedError("Cloud workspace does not belong to this repository and account")
    }
    if (row.sessions.some((s) => s.workspaceId !== row.workspaceId || s.organizationId !== org)) return invalid()
    return row
  }
  const active = async (input: { workspaceID: string; cursor?: string }, signal: AbortSignal) => {
    const row = await detail(input, signal)
    if (row.deletionState !== "active") throw new HostedError("Cloud workspace is being deleted")
    return row
  }
  const result = (raw: unknown, messageID?: string, workspaceID?: string) => {
    if (
      !Schema.is(Created)(raw) ||
      (messageID !== undefined && messageID !== raw.messageId) ||
      (workspaceID !== undefined && workspaceID !== raw.workspaceId)
    )
      return invalid()
    for (const [id, expires] of admitted) if (expires <= Date.now()) admitted.delete(id)
    if (admitted.size >= 64) admitted.delete(admitted.keys().next().value!)
    admitted.set(key(raw.workspaceId, raw.kiloSessionId), Date.now() + 120_000)
    return {
      target: { scope, providerID: "kilo-cloud" as const, workspaceID: raw.workspaceId, sessionID: raw.kiloSessionId },
      replayed: raw.replayed ?? false,
    }
  }

  return {
    async cancelQueued(target: KiloHostedRpc.Target, messageID: string, signal: AbortSignal) {
      const sessionId = await this.authorize(target, signal)
      const result = await procedure("cancelQueuedMessage", { sessionId, messageId: messageID }, signal, true)
      if (!Schema.is(Schema.Struct({ dropped: Schema.Boolean }))(result)) return invalid()
      return { dropped: result.dropped }
    },
    /** Only called after authorizing the viewed session and receiving an unready terminal response. */
    async readySibling(target: KiloHostedRpc.Target, signal: AbortSignal) {
      let cursor: string | undefined
      for (let page = 0; page < 20; page++) {
        const row = await active({ workspaceID: target.workspaceID, cursor }, signal)
        const siblings = row.sessions.filter((s) => s.kiloSessionId !== target.sessionID)
        for (let offset = 0; offset < siblings.length; offset += 4) {
          const ready = await Promise.all(
            siblings.slice(offset, offset + 4).map(async (s) => {
              const meta = await procedure("getSession", { cloudAgentSessionId: s.cloudAgentSessionId }, signal)
              return Schema.is(Schema.Struct({ routeReady: Schema.Literal(true) }))(meta)
                ? s.cloudAgentSessionId
                : undefined
            }),
          )
          const owner = ready.find(Boolean)
          if (owner) return owner
        }
        cursor = row.nextSessionCursor ?? undefined
        if (!cursor) break
      }
    },
    workspace: async (input: { workspaceID: string; cursor?: string }, signal: AbortSignal) =>
      project(await detail(input, signal)),
    async authorize(target: KiloHostedRpc.Target, signal: AbortSignal) {
      let cursor: string | undefined
      for (let i = 0; i < 20; i++) {
        const row = await active({ workspaceID: target.workspaceID, ...(cursor ? { cursor } : {}) }, signal)
        const session = row.sessions.find((s) => s.kiloSessionId === target.sessionID)
        if (session) {
          admitted.delete(key(target.workspaceID, target.sessionID))
          return session.cloudAgentSessionId
        }
        cursor = row.nextSessionCursor ?? undefined
        if (!cursor) break
      }
      if ((admitted.get(key(target.workspaceID, target.sessionID)) ?? 0) > Date.now())
        throw new HostedPreparing("Cloud is registering the new workspace session.")
      throw new HostedError("Cloud session does not belong to this workspace")
    },
    async list(input: { cursor?: string }, signal: AbortSignal) {
      const page = await procedure(
        "listHostedWorkspaces",
        { repositoryUrl: remote, limit: 50, sessionLimit: 10, cursor: input.cursor },
        signal,
      )
      if (!Schema.is(Page)(page)) return invalid()
      // The Cloud catalog is user-scoped and can include a different payer's workspaces.
      return {
        items: page.items.filter((row) => row.organizationId === org && sameRepository(row)).map(project),
        ...(page.nextCursor ? { cursor: page.nextCursor } : {}),
      }
    },
    async profiles(signal: AbortSignal) {
      const page = await procedure("listHostedWorkspaceProfiles", org ? { kilocodeOrganizationId: org } : {}, signal)
      if (!Schema.is(Profiles)(page)) return invalid()
      const items = [...page.personalProfiles, ...(org ? page.organizationProfiles : [])].map((p) => ({
        id: p.id,
        name: p.name,
        owner: p.ownerType === "user" ? ("personal" as const) : ("organization" as const),
      }))
      return {
        items,
        ...(page.effectiveDefaultProfileId ? { effectiveDefaultProfileID: page.effectiveDefaultProfileId } : {}),
      }
    },
    async create(input: KiloHostedRpc.Create, signal: AbortSignal) {
      if (input.attachments) throw new HostedError("Cloud attachments require upload-aware session creation.")
      const body = await procedure(
        "createHostedWorkspace",
        {
          clientProvenance: "agent-manager",
          operationKey: input.operationKey,
          repository: repositoryPayload(remote, input.branch),
          agent: input.agent,
          ...(input.profileID ? { profile: { id: input.profileID } } : {}),
          ...(input.prompt ? { message: { id: input.messageID, prompt: input.prompt } } : {}),
          ...(org ? { options: { kilocodeOrganizationId: org } } : {}),
        },
        signal,
        true,
      )
      return result(body, input.messageID)
    },
    async start(input: KiloHostedRpc.Start, signal: AbortSignal) {
      await active(input, signal)
      const body = await procedure(
        "createHostedWorkspaceSession",
        {
          clientProvenance: "agent-manager",
          operationKey: input.operationKey,
          workspaceId: input.workspaceID,
          agent: input.agent,
          message: { id: input.messageID, prompt: input.prompt },
          ...(org ? { kilocodeOrganizationId: org } : {}),
        },
        signal,
        true,
      )
      return result(body, input.messageID, input.workspaceID)
    },
  }
}

function project(row: typeof Row.Type): KiloHostedRpc.Workspace {
  if (row.sessions.some((s) => s.workspaceId !== row.workspaceId || s.organizationId !== row.organizationId))
    return invalid()
  return {
    workspaceID: row.workspaceId,
    deletionState: row.deletionState,
    ...(row.gitBranch ? { branch: row.gitBranch } : {}),
    ...(row.name ? { name: row.name } : {}),
    sessions: row.sessions.map((s) => ({ sessionID: s.kiloSessionId, ...(s.title ? { title: s.title } : {}) })),
    ...(row.nextSessionCursor ? { cursor: row.nextSessionCursor } : {}),
  }
}
