import type { LocationGetOutput, ModelRef, OpenCodeClient, SessionInfo } from "@opencode/client/promise"
import { Model } from "@opencode/schema/model"
import { KiloHandshakeRpc } from "@opencode/schema/kilocode/handshake" // kilocode_change(session-sync)
import { KiloSessionSyncRpc } from "@opencode/schema/kilocode/session-sync" // kilocode_change(session-sync)
import { waitForPlugins } from "./services/plugin-startup" // kilocode_change(session-sync)
import { Effect } from "effect" // kilocode_change(session-sync)
import path from "node:path"
import { errorMessage } from "./util/error"

const SESSION_PAGE_LIMIT = 50
// kilocode_change(session-sync) start
export const syncedDeletedMessage = "This session was deleted on another device; it is no longer synced."

export type SyncedPull =
  | { type: "pulled"; sessionID: string; outcome: string }
  /** No synced copy is addressable here, so the caller keeps its existing "create new" behavior. */
  | { type: "absent" }
  /** The cloud session is tombstoned; the caller refuses and offers --as-new. */
  | { type: "deleted" }
  /** The pull could not be attempted or was rejected; continuing would run on a stale log. */
  | { type: "failed"; retryable: boolean; message: string }

const absentCodes: Record<string, true> = { session_not_found: true, sync_disabled: true }

function rpcCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("data" in error)) return undefined
  const data = error.data
  if (typeof data !== "object" || data === null || !("code" in data) || typeof data.code !== "string") return undefined
  return data.code
}

export async function pullSyncedSession(input: {
  client: OpenCodeClient
  sessionID: string
  directory: string
  asNew?: boolean
  signal?: AbortSignal
}): Promise<SyncedPull> {
  // A cold Location answers `rpc.unavailable` until its plugins register. Pulling first silently skipped the
  // import and let the turn reuse the remote log's sequence numbers, so readiness comes first, exactly as the
  // `sync` commands do it.
  await Effect.runPromise(waitForPlugins(input.client, input.directory))
  await input.client
    .rpc(KiloHandshakeRpc.Definition)
    .get({}, { location: { directory: input.directory }, signal: input.signal })
    .catch(() => undefined)
  try {
    const result = await input.client.rpc(KiloSessionSyncRpc.Definition).pull(
      { directory: input.directory, sessionID: input.sessionID, replaceLocal: false, asNew: input.asNew ?? false },
      { location: { directory: input.directory }, signal: input.signal },
    )
    return { type: "pulled", sessionID: result.sessionID, outcome: result.outcome }
  } catch (error) {
    const code = rpcCode(error)
    if (code === "session_deleted") return { type: "deleted" }
    if (code !== undefined && absentCodes[code]) return { type: "absent" }
    if (code !== undefined)
      return {
        type: "failed",
        retryable: false,
        message: `The synced copy of this session could not be loaded (${code}).`,
      }
    return {
      type: "failed",
      retryable: true,
      message:
        "The synced copy of this session could not be checked because the Kilo server is not ready; retry the command.",
    }
  }
}
// kilocode_change(session-sync) end

export type SessionTarget = {
  session: SessionInfo
  location: LocationGetOutput
  model: ModelRef | undefined
  agent: string | undefined
  resume: boolean
}

export type SessionTargetPreparation = (input: {
  client: OpenCodeClient
  location: LocationGetOutput
  session: SessionInfo | undefined
  model: ModelRef | undefined
  agent: string | undefined
  signal?: AbortSignal
}) => Promise<{ model: ModelRef | undefined; agent: string | undefined }>

export class SessionTargetMutationError extends Error {
  override readonly name = "SessionTargetMutationError"

  constructor(cause: unknown) {
    super(errorMessage(cause), { cause })
  }
}

export async function resolveSessionTarget(input: {
  client: OpenCodeClient
  location?: { directory?: string; workspace?: string }
  continue?: boolean
  session?: string
  fork?: boolean
  asNew?: boolean // kilocode_change(session-sync)
  model?: ModelRef
  agent?: string
  environment?: Readonly<Record<string, string>>
  prepare: SessionTargetPreparation
  signal?: AbortSignal
}): Promise<SessionTarget> {
  const selection = await selectSession(input)
  const selected = selection.session
  const location =
    selection.location ??
    (await resolveLocation(
      input.client,
      selected ? { directory: selected.location.directory } : input.location,
      input.signal,
    ))
  const prepared = await input.prepare({
    client: input.client,
    location,
    session: selected,
    model: input.model ?? selected?.model,
    agent: input.agent ?? selected?.agent,
    signal: input.signal,
  })
  const session =
    selected ??
    (await input.client.session
      .create(
        {
          id: input.session,
          agent: prepared.agent,
          model: prepared.model,
          location: { directory: location.directory },
        },
        ...requestOptions(input.signal),
      )
      .catch((error) => {
        throw new SessionTargetMutationError(error)
      }))
  if (input.environment !== undefined)
    await input.client.session
      .environment({ sessionID: session.id, variables: input.environment }, ...requestOptions(input.signal))
      .catch((error) => {
        throw new SessionTargetMutationError(error)
      })
  return {
    session,
    location,
    model: prepared.model,
    agent: prepared.agent ?? session.agent,
    resume: selected !== undefined,
  }
}

export function parseSessionTargetModel(value?: string): ModelRef | undefined {
  if (!value) return
  const model = Model.Ref.parse(value)
  return { providerID: model.providerID, id: model.id, variant: model.variant }
}

async function selectSession(input: {
  client: OpenCodeClient
  location?: { directory?: string }
  continue?: boolean
  session?: string
  fork?: boolean
  asNew?: boolean
  signal?: AbortSignal
}) {
  // kilocode_change(session-sync) start
  if (input.session && input.asNew && !input.fork) {
    const pulled = await pullSyncedSession({
      client: input.client,
      sessionID: input.session,
      directory: input.location?.directory ?? process.cwd(),
      asNew: true,
      signal: input.signal,
    })
    if (pulled.type === "deleted") throw new Error(`${syncedDeletedMessage} Continue as a new session with --as-new.`)
    if (pulled.type === "failed") throw new Error(pulled.message)
    if (pulled.type === "pulled") {
      const created = await findSession(input.client, pulled.sessionID, input.signal)
      if (created) return { session: created }
    }
  }
  // kilocode_change(session-sync) end
  let explicit = input.session ? await findSession(input.client, input.session, input.signal) : undefined
  // kilocode_change(session-sync) start
  if (input.session && !input.fork && !input.asNew) {
    const pulled = await pullSyncedSession({
      client: input.client,
      sessionID: input.session,
      directory: explicit?.location.directory ?? input.location?.directory ?? process.cwd(),
      signal: input.signal,
    })
    if (pulled.type === "deleted") throw new Error(`${syncedDeletedMessage} Continue as a new session with --as-new.`)
    if (pulled.type === "failed") throw new Error(pulled.message)
    if (pulled.type === "pulled") explicit = (await findSession(input.client, pulled.sessionID, input.signal)) ?? explicit
  }
  // kilocode_change(session-sync) end
  if (input.session && !explicit) {
    if (input.fork) throw new Error("Session not found")
    return { session: undefined }
  }
  if (explicit)
    return {
      session: input.fork
        ? await input.client.session
            .fork({ sessionID: explicit.id }, ...requestOptions(input.signal))
            .catch((error) => {
              throw new SessionTargetMutationError(error)
            })
        : explicit,
    }
  if (!input.continue) return { session: undefined }

  const location = await resolveLocation(input.client, input.location, input.signal)
  const selected = await latestSession(input.client, location, undefined, input.signal)
  if (!selected) return { session: undefined, location }
  return {
    session: input.fork
      ? await input.client.session.fork({ sessionID: selected.id }, ...requestOptions(input.signal)).catch((error) => {
          throw new SessionTargetMutationError(error)
        })
      : selected,
  }
}

/** Create a new worktree of the location's project, keeping the caller's subfolder when the worktree has it. */
export async function createWorktreeLocation(input: {
  client: OpenCodeClient
  location?: { directory?: string }
  name?: string
  signal?: AbortSignal
}) {
  const base = await resolveLocation(input.client, input.location, input.signal)
  const created = await input.client.worktree
    .create(
      { projectID: base.project.id, from: base.project.directory, name: input.name },
      ...requestOptions(input.signal),
    )
    .catch((error) => {
      throw new SessionTargetMutationError(error)
    })
  const subfolder = path.relative(base.project.directory, base.directory)
  if (!subfolder || subfolder.startsWith("..") || path.isAbsolute(subfolder))
    return { root: created.directory, directory: created.directory }
  const directory = path.join(created.directory, subfolder)
  return resolveLocation(input.client, { directory }, input.signal).then(
    () => ({ root: created.directory, directory }),
    () => ({ root: created.directory, directory: created.directory }),
  )
}

export function findSession(client: OpenCodeClient, sessionID: string, signal?: AbortSignal) {
  return client.session.get({ sessionID }, ...requestOptions(signal)).catch((error) => {
    if (error && typeof error === "object" && "_tag" in error && error._tag === "SessionNotFoundError") return undefined
    throw error
  })
}

async function latestSession(
  client: OpenCodeClient,
  location: LocationGetOutput,
  cursor?: string,
  signal?: AbortSignal,
): Promise<SessionInfo | undefined> {
  const page = await client.session.list(
    {
      directory: location.directory,
      parentID: null,
      archived: false,
      limit: SESSION_PAGE_LIMIT,
      order: "desc",
      ...(cursor ? { cursor } : {}),
    },
    ...requestOptions(signal),
  )
  const selected = page.data.find((session) => session.location.directory === location.directory)
  if (selected) return selected
  if (!page.cursor.next || page.data.length === 0) return
  return latestSession(client, location, page.cursor.next, signal)
}

function resolveLocation(client: OpenCodeClient, location?: { directory?: string }, signal?: AbortSignal) {
  if (!location && !signal) return client.location.get()
  if (!location) return client.location.get(undefined, { signal })
  return client.location.get({ location }, ...requestOptions(signal))
}

function requestOptions(signal?: AbortSignal): [] | [{ signal: AbortSignal }] {
  return signal ? [{ signal }] : []
}
