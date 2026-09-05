import type { ModelInfo, OpenCodeClient, ProviderInfo } from "@opencode-ai/client"
import type { Context, Plugin } from "@opencode-ai/plugin/effect/plugin"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect, PubSub, Scope, Stream } from "effect"
import { readdir, realpath, stat } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import {
  RemoteCommandListSchema,
  RemoteCreateSessionSchema,
  RemoteDirectoryListSchema,
  RemoteDropQueuedMessageSchema,
  RemoteInboundSchema,
  RemoteModelListSchema,
  RemoteMultipartMessageSchema,
  RemoteRenameSchema,
  RemoteSendCommandSchema,
  type RemoteInbound,
  type RemoteMessagePart,
  type RemoteOutbound,
} from "./remote-protocol"

/**
 * The host normally supplies a full public client; the model and provider
 * namespaces stay optional so pre-catalog hosts can still run the session
 * relay. list_models degrades to an explicit error without them.
 */
export type RemoteSessionClient = Pick<OpenCodeClient, "command" | "session"> &
  Partial<Pick<OpenCodeClient, "model" | "provider">>

export type RemoteSessionConnection = {
  /** Explicit relay origin. Production must use HTTPS; tests may opt into loopback HTTP. */
  readonly relayURL: string
  /** Resolved by the host's validated Kilo account callback; never read from env or storage here. */
  readonly bearerToken: string
  /** The authenticated local public client supplied by the host at plugin activation. */
  readonly client: () => RemoteSessionClient
  readonly allowHttpLoopback?: boolean
}

type AdapterEvent = { readonly type: "heartbeat" } | { readonly type: "inbound"; readonly data: RemoteInbound }
type LifecycleEvent =
  | "session.execution.started"
  | "session.execution.succeeded"
  | "session.execution.failed"
  | "session.execution.interrupted"

export type RemoteSessionContext = Pick<Context, "event" | "location">

export type RemoteSessionHandle = {
  readonly connected: boolean
}

type RelaySocket = RemoteSessionHandle & {
  send(data: RemoteOutbound): void
  close(): void
}

/** Connect the explicit v1 relay transport to the authenticated public v2 client. */
export function createRemoteSessionPlugin(connection: RemoteSessionConnection): Plugin {
  validateConnection(connection)
  return define({
    id: "kilocode.remote-session",
    effect: (ctx) => installRemoteSessionAdapter(ctx, connection, connection.client()).pipe(Effect.asVoid),
  })
}

export function installRemoteSessionAdapter(
  ctx: RemoteSessionContext,
  connection: Omit<RemoteSessionConnection, "client">,
  client: RemoteSessionClient,
): Effect.Effect<RemoteSessionHandle, never, Scope.Scope> {
  validateConnection(connection)
  return Effect.gen(function* () {
    const events = yield* PubSub.unbounded<AdapterEvent>()
    const admitted = new Map<string, string>()
    const socket = connect(connection, (event) => {
      if (event.type === "inbound") {
        void Effect.runPromise(inbound(ctx, client, socket, admitted, event.data))
        return
      }
      PubSub.publishUnsafe(events, event)
    })
    const interval = setInterval(() => {
      PubSub.publishUnsafe(events, { type: "heartbeat" })
    }, 10_000)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        clearInterval(interval)
        socket.close()
      }),
    )
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event): event is Extract<typeof event, { readonly type: LifecycleEvent }> =>
        isLifecycleEvent(event.type),
      ),
      Stream.runForEach(() =>
        Effect.sync(() => {
          // session.active() is authoritative at heartbeat time. Lifecycle
          // events make that reconciliation prompt instead of waiting 10s.
          PubSub.publishUnsafe(events, { type: "heartbeat" })
        }),
      ),
      Effect.catch(() => Effect.void),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* Stream.fromPubSub(events).pipe(
      Stream.runForEach(() => heartbeat(ctx, client, socket)),
      Effect.forkScoped({ startImmediately: true }),
    )
    return socket
  })
}

function validateConnection(input: Omit<RemoteSessionConnection, "client">) {
  const url = new URL(input.relayURL)
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]"
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Remote relay URL must be a bare origin without credentials, query, or path")
  }
  if (url.protocol !== "https:" && !(input.allowHttpLoopback && url.protocol === "http:" && loopback)) {
    throw new Error("Remote relay URL must use HTTPS (HTTP is limited to explicit loopback tests)")
  }
  if (!input.bearerToken.trim()) throw new Error("Remote relay bearer token is required")
}

function connect(
  connection: Omit<RemoteSessionConnection, "client">,
  offer: (event: AdapterEvent) => void,
): RelaySocket {
  const url = new URL(connection.relayURL)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/api/user/cli"
  url.searchParams.set("token", connection.bearerToken)
  url.searchParams.set("connectionId", crypto.randomUUID())
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let backoff = 1_000
  let closed = false
  let permanent = false
  const buffer: string[] = []

  const schedule = () => {
    if (closed || permanent || retry) return
    retry = setTimeout(() => {
      retry = undefined
      open()
    }, backoff)
    backoff = Math.min(backoff * 2, 60_000)
  }

  const open = () => {
    if (closed || permanent) return
    try {
      const next = new WebSocket(url)
      socket = next
      next.onopen = () => {
        if (closed || socket !== next) return next.close()
        backoff = 1_000
        for (const message of buffer) next.send(message)
        buffer.length = 0
        offer({ type: "heartbeat" })
      }
      next.onmessage = (event) => {
        if (closed || socket !== next) return
        try {
          const value = RemoteInboundSchema.safeParse(JSON.parse(String(event.data)))
          if (value.success) offer({ type: "inbound", data: value.data })
        } catch {
          // Invalid relay frames are ignored without reflecting their raw content.
        }
      }
      next.onclose = (event) => {
        if (socket !== next) return
        socket = undefined
        if (closed) return
        if (event.code === 4401 || event.code === 4403 || event.code === 4409) {
          permanent = true
          buffer.length = 0
          return
        }
        schedule()
      }
    } catch {
      schedule()
    }
  }

  open()
  return {
    send(data) {
      const message = JSON.stringify(data)
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(message)
        return
      }
      if (permanent || closed) return
      buffer.push(message)
      if (buffer.length > 200) buffer.shift()
    },
    close() {
      closed = true
      if (retry) clearTimeout(retry)
      socket?.close()
      buffer.length = 0
    },
    get connected() {
      return socket?.readyState === WebSocket.OPEN
    },
  }
}

function heartbeat(ctx: RemoteSessionContext, client: Pick<OpenCodeClient, "session">, socket: RelaySocket) {
  return Effect.tryPromise({
    try: async () => {
      const [listed, active] = await Promise.all([
        client.session.list({ directory: ctx.location.directory, workspace: ctx.location.workspaceID }),
        client.session.active(),
      ])
      send(socket, {
        type: "heartbeat",
        sessions: listed.data.flatMap((session) => {
          if (!sameLocation(session.location, ctx.location) || !session.title) return []
          return [
            {
              id: session.id,
              title: session.title,
              status: active[session.id] ? "busy" : "idle",
              ...(session.parentID === undefined ? {} : { parentSessionId: session.parentID }),
            },
          ]
        }),
      })
    },
    catch: () => undefined,
  }).pipe(Effect.catch(() => Effect.void))
}

function inbound(
  ctx: RemoteSessionContext,
  client: RemoteSessionClient,
  socket: RelaySocket,
  admitted: Map<string, string>,
  input: RemoteInbound,
) {
  if (input.type === "subscribe" || input.type === "unsubscribe" || input.type === "heartbeat_ack") {
    return heartbeat(ctx, client, socket)
  }
  if (input.type === "system") return rename(ctx, client, input.data)
  if (input.command === "send_message") return sendMessage(ctx, client, socket, admitted, input)
  if (input.command === "send_command") return sendCommand(ctx, client, socket, input)
  if (input.command === "list_directories") return listDirectories(ctx, socket, input)
  if (input.command === "list_commands") return listCommands(ctx, client, socket, input)
  if (input.command === "list_models") return listModels(ctx, client, socket, input)
  if (input.command === "create_session") return createSession(ctx, client, socket, input)
  if (input.command === "interrupt") return interrupt(ctx, client, socket, input)
  if (input.command === "drop_queued_message") return dropQueuedMessage(ctx, client, socket, admitted, input)
  return Effect.sync(() =>
    send(socket, { type: "response", id: input.id, error: `unsupported command: ${input.command}` }),
  )
}

function rename(ctx: RemoteSessionContext, client: Pick<OpenCodeClient, "session">, data: unknown) {
  const parsed = RemoteRenameSchema.safeParse(data)
  if (!parsed.success) return Effect.void
  return localSession(ctx, client, parsed.data.sessionId).pipe(
    Effect.flatMap((session) =>
      session
        ? Effect.tryPromise({
            try: () => client.session.rename({ sessionID: session.id, title: parsed.data.title }),
            catch: () => undefined,
          }).pipe(Effect.catch(() => Effect.void))
        : Effect.void,
    ),
  )
}

function sendMessage(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "session">,
  socket: RelaySocket,
  admitted: Map<string, string>,
  input: Extract<RemoteInbound, { type: "command" }>,
) {
  const parsed = RemoteMultipartMessageSchema.safeParse(input.data)
  if (!parsed.success) return respond(socket, input.id, "unsupported send_message payload")
  const texts = parsed.data.parts.filter((part): part is Extract<RemoteMessagePart, { type: "text" }> => part.type === "text")
  if (texts.length !== 1) return respond(socket, input.id, "unsupported send_message payload")
  const files: { uri: string; name?: string }[] = []
  for (const part of parsed.data.parts) {
    if (part.type !== "file") continue
    // Remote callers may only submit inline bytes. The v1 relay materialized
    // https:// attachments by fetching them, which this adapter must never do;
    // file: URLs would make the host read caller-named local paths. Both are
    // rejected here instead of being forwarded to the public prompt API.
    if (!part.url.startsWith("data:")) {
      return respond(socket, input.id, "send_message file parts must be inline data URLs")
    }
    files.push({ uri: part.url, ...(part.filename === undefined ? {} : { name: part.filename }) })
  }
  return localSession(ctx, client, parsed.data.sessionID).pipe(
    Effect.flatMap((session) => {
      if (!session) return respond(socket, input.id, "session unavailable")
      return Effect.tryPromise({
        try: () =>
          client.session.prompt({
            sessionID: session.id,
            text: texts[0].text,
            ...(files.length === 0 ? {} : { files }),
            ...(parsed.data.messageID === undefined ? {} : { id: parsed.data.messageID }),
          }),
        catch: () => "failed" as const,
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (parsed.data.messageID) admitted.set(parsed.data.messageID, session.id)
          }),
        ),
        Effect.andThen(respond(socket, input.id)),
        Effect.catch(() => respond(socket, input.id, "failed to admit message")),
      )
    }),
  )
}

function sendCommand(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "command" | "session">,
  socket: RelaySocket,
  input: Extract<RemoteInbound, { type: "command" }>,
) {
  const parsed = RemoteSendCommandSchema.safeParse(input.data)
  if (!parsed.success) return respond(socket, input.id, "invalid send_command command")
  if (parsed.data.messageID || parsed.data.model || parsed.data.variant) {
    return respond(socket, input.id, "send_command model, variant, and messageID are unsupported")
  }
  if (!input.sessionId) return respond(socket, input.id, "invalid send_command command")
  return localSession(ctx, client, input.sessionId).pipe(
    Effect.flatMap((session) => {
      if (!session) return respond(socket, input.id, "session unavailable")
      return Effect.tryPromise({
        try: () => client.command.list({ location: session.location }),
        catch: () => "failed" as const,
      }).pipe(
        Effect.flatMap((commands) => {
          if (!commands.data.some((command) => command.name === parsed.data.command)) {
            return respond(socket, input.id, "unknown slash command")
          }
          return Effect.tryPromise({
            try: () =>
              client.session.command({
                sessionID: session.id,
                command: parsed.data.command,
                text: parsed.data.arguments,
              }),
            catch: () => "failed" as const,
          }).pipe(
            Effect.andThen(respond(socket, input.id)),
            Effect.catch(() => respond(socket, input.id, "failed to admit command")),
          )
        }),
        Effect.catch(() => respond(socket, input.id, "failed to list commands")),
      )
    }),
  )
}

function listCommands(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "command" | "session">,
  socket: RelaySocket,
  input: Extract<RemoteInbound, { type: "command" }>,
) {
  if (!RemoteCommandListSchema.safeParse(input.data).success || !input.sessionId) {
    return respond(socket, input.id, "invalid list_commands request")
  }
  return localSession(ctx, client, input.sessionId).pipe(
    Effect.flatMap((session) => {
      if (!session) return respond(socket, input.id, "session unavailable")
      return Effect.tryPromise({
        try: () => client.command.list({ location: session.location }),
        catch: () => "failed" as const,
      }).pipe(
        Effect.tap((result) =>
          respond(socket, input.id, {
            protocolVersion: 1,
            commands: result.data.map((command) => ({
              name: command.name,
              ...(command.description === undefined ? {} : { description: command.description }),
              hints: [],
            })),
          }),
        ),
        Effect.catch(() => respond(socket, input.id, "failed to list commands")),
      )
    }),
  )
}

function listModels(
  ctx: RemoteSessionContext,
  client: RemoteSessionClient,
  socket: RelaySocket,
  input: Extract<RemoteInbound, { type: "command" }>,
) {
  if (!RemoteModelListSchema.safeParse(input.data).success) {
    return respond(socket, input.id, "invalid list_models command")
  }
  const catalog = client.model
  const inventory = client.provider
  if (!catalog || !inventory) {
    return respond(socket, input.id, "model catalog is unavailable")
  }
  return (
    input.sessionId === undefined
      ? Effect.succeed(undefined)
      : localSession(ctx, client, input.sessionId).pipe(
          Effect.flatMap((session) =>
            session ? Effect.succeed(session.model) : Effect.fail("session unavailable"),
          ),
        )
  ).pipe(
    Effect.flatMap((current) =>
      Effect.tryPromise({
        try: async () => {
          const location = {
            directory: ctx.location.directory,
            ...(ctx.location.workspaceID === undefined ? {} : { workspace: ctx.location.workspaceID }),
          }
          const [models, providers, fallback] = await Promise.all([
            catalog.list({ location }),
            inventory.list({ location }),
            catalog.default({ location }),
          ])
          return modelCatalogResult({
            models: models.data,
            providers: providers.data,
            defaultModel: fallback.data,
            currentModel: current,
          })
        },
        catch: () => "failed to list models" as const,
      }),
    ),
    Effect.flatMap((result) => respond(socket, input.id, result)),
    Effect.catch((error) => respond(socket, input.id, typeof error === "string" ? error : "failed to list models")),
  )
}

// V1 relay catalog bounds, from origin/main ecccd1f remote-model-catalog.ts.
const MAX_MODELS = 2_048
const MAX_NAME_LENGTH = 256
const MAX_VARIANT_KEY_LENGTH = 64
const MAX_VARIANTS = 32
// v1 Provider.sort ordering: priority-substring rank descending, "latest"
// models first, then model id descending.
const MODEL_SORT_PRIORITY = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]

type WireModel = {
  id: string
  providerID: string
  api: { id: string; url: string; npm: string }
  name: string
  capabilities: {
    toolcall: boolean
    input: Record<(typeof MODALITIES)[number], boolean>
    output: Record<(typeof MODALITIES)[number], boolean>
  }
  cost: { input: 0; output: 0; cache: { read: 0; write: 0 } }
  limit: { context: number; input?: number; output: number }
  status: ModelInfo["status"]
  options: Record<string, never>
  headers: Record<string, never>
  release_date: string
  variants: Record<string, Record<string, never>>
}

type WireProvider = {
  id: string
  name: string
  source: "custom"
  env: string[]
  options: Record<string, never>
  models: Record<string, WireModel>
}

const MODALITIES = ["text", "audio", "image", "video", "pdf"] as const

/**
 * Translate the public v2 model inventory into the v1 list_models response.
 * Only the fields the v1 catalog sanitizer emitted travel on the wire: v2
 * provider/model settings, headers, body, and package metadata are dropped,
 * and v1's neutral constants (zeroed cost, empty options/headers/env) are
 * emitted exactly as v1's sanitizer wrote them.
 */
function modelCatalogResult(input: {
  models: ReadonlyArray<ModelInfo>
  providers: ReadonlyArray<ProviderInfo>
  defaultModel: ModelInfo | null | undefined
  currentModel: { id: string; providerID: string; variant?: string } | undefined
}) {
  const grouped = new Map<string, WireModel[]>()
  for (const source of input.models) {
    const model = wireModel(source)
    if (!model) continue
    const bucket = grouped.get(source.providerID)
    if (bucket) bucket.push(model)
    else grouped.set(source.providerID, [model])
  }
  const named = new Map(input.providers.map((provider) => [provider.id, provider]))
  const all: WireProvider[] = []
  let modelCount = 0
  let truncated = false
  for (const [providerID, models] of grouped) {
    const remaining = MAX_MODELS - modelCount
    if (remaining <= 0) {
      truncated = true
      break
    }
    const sorted = sortModels(models)
    const kept = sorted.length > remaining ? sorted.slice(0, remaining) : sorted
    truncated ||= sorted.length > remaining
    modelCount += kept.length
    all.push({
      id: providerID,
      name: (named.get(providerID)?.name ?? providerID).slice(0, MAX_NAME_LENGTH),
      source: "custom",
      env: [],
      options: {},
      models: Object.fromEntries(kept.map((model) => [model.id, model])),
    })
  }
  const defaults: Record<string, string> = {}
  for (const provider of all) {
    const preferred = Object.values(provider.models)[0]
    if (preferred) defaults[provider.id] = preferred.id
  }
  const current = input.currentModel
  const currentModel =
    current && current.providerID.length > 0 && current.id.length > 0 && presentIn(all, current.providerID, current.id)
      ? {
          model: { providerID: current.providerID, modelID: current.id },
          ...(current.variant === undefined || current.variant === "default"
            ? {}
            : { variant: current.variant }),
        }
      : undefined
  const fallback = input.defaultModel
  const defaultModel =
    fallback && presentIn(all, fallback.providerID, fallback.id)
      ? { providerID: fallback.providerID, modelID: fallback.id }
      : undefined
  return {
    all,
    default: defaults,
    connected: all.map((provider) => provider.id),
    failed: [] as string[],
    protocolVersion: 1,
    truncated,
    ...(currentModel ? { currentModel } : {}),
    ...(defaultModel ? { defaultModel } : {}),
  }
}

/**
 * v1 wire model. v1 sanitizer fields with no v2 public source
 * (capabilities temperature/reasoning/attachment/interleaved, recommendedIndex,
 * isFree, mayTrainOnYourPrompts, hasUserByokAvailable) are omitted rather than
 * asserted; the v2 modality arrays and tool support are the only proven
 * capability facts. The wire identity is the v2 catalog id: session selection
 * resolves catalog ids, while `modelID` is only the provider route target
 * (alias catalogs route chat -> vendor/chat and must keep advertising `chat`).
 */
function wireModel(source: ModelInfo): WireModel | undefined {
  if (!Number.isFinite(source.limit.context) || source.limit.context < 0) return undefined
  if (!Number.isFinite(source.limit.output) || source.limit.output < 0) return undefined
  if (source.limit.input !== undefined && (!Number.isFinite(source.limit.input) || source.limit.input < 0)) {
    return undefined
  }
  if (!source.id) return undefined
  return {
    id: source.id,
    providerID: source.providerID,
    api: { id: source.id, url: "", npm: "" },
    name: source.name.slice(0, MAX_NAME_LENGTH),
    capabilities: {
      toolcall: source.capabilities.tools,
      input: modalities(source.capabilities.input),
      output: modalities(source.capabilities.output),
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: {
      context: source.limit.context,
      ...(source.limit.input === undefined ? {} : { input: source.limit.input }),
      output: source.limit.output,
    },
    status: source.status,
    options: {},
    headers: {},
    release_date: "",
    variants: Object.fromEntries(
      source.variants
        .filter((variant) => variant.id.length > 0 && variant.id.length <= MAX_VARIANT_KEY_LENGTH)
        .slice(0, MAX_VARIANTS)
        .map((variant) => [variant.id, {}]),
    ),
  }
}

function modalities(values: ReadonlyArray<string>) {
  return {
    text: values.includes("text"),
    audio: values.includes("audio"),
    image: values.includes("image"),
    video: values.includes("video"),
    pdf: values.includes("pdf"),
  } satisfies Record<(typeof MODALITIES)[number], boolean>
}

function sortModels(models: WireModel[]) {
  return models.toSorted((left, right) => {
    const priority =
      MODEL_SORT_PRIORITY.findIndex((filter) => right.id.includes(filter)) -
      MODEL_SORT_PRIORITY.findIndex((filter) => left.id.includes(filter))
    if (priority !== 0) return priority
    const latest = (right.id.includes("latest") ? 0 : 1) - (left.id.includes("latest") ? 0 : 1)
    if (latest !== 0) return latest
    if (right.id < left.id) return -1
    if (right.id > left.id) return 1
    return 0
  })
}

function presentIn(providers: WireProvider[], providerID: string, modelID: string) {
  const provider = providers.find((candidate) => candidate.id === providerID)
  return provider !== undefined && Object.hasOwn(provider.models, modelID)
}

function createSession(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "session">,
  socket: RelaySocket,
  input: Extract<RemoteInbound, { type: "command" }>,
) {
  const parsed = RemoteCreateSessionSchema.safeParse(input.data)
  if (!parsed.success) return respond(socket, input.id, "invalid create_session command")
  if (parsed.data.cloneFromKiloSessionId) return respond(socket, input.id, "cloud session clone is unsupported")
  return Effect.tryPromise({
    try: async () => {
      const directory = await createDirectory(ctx, client, input.sessionId, parsed.data.directory)
      if (!directory) return
      return client.session.create({
        ...(parsed.data.agent === undefined ? {} : { agent: parsed.data.agent }),
        ...(parsed.data.model === undefined
          ? {}
          : {
              model: {
                providerID: parsed.data.model.providerID,
                id: parsed.data.model.modelID,
                ...(parsed.data.model.variant === undefined ? {} : { variant: parsed.data.model.variant }),
              },
            }),
        ...(parsed.data.orgId === undefined ? {} : { metadata: { orgId: parsed.data.orgId } }),
        location: {
          directory,
          ...(ctx.location.workspaceID === undefined ? {} : { workspaceID: ctx.location.workspaceID }),
        },
      })
    },
    catch: () => "failed" as const,
  }).pipe(
    Effect.flatMap((session) => {
      if (!session) return respond(socket, input.id, "invalid create_session directory")
      return heartbeat(ctx, client, socket).pipe(
        Effect.andThen(respond(socket, input.id, { protocolVersion: 1, sessionID: session.id })),
      )
    }),
    Effect.catch(() => respond(socket, input.id, "failed to create session")),
  )
}

function interrupt(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "session">,
  socket: RelaySocket,
  input: Extract<RemoteInbound, { type: "command" }>,
) {
  if (!input.sessionId) return respond(socket, input.id, "invalid interrupt command")
  return localSession(ctx, client, input.sessionId).pipe(
    Effect.flatMap((session) => {
      if (!session) return respond(socket, input.id, "session unavailable")
      return Effect.tryPromise({
        try: () => client.session.interrupt({ sessionID: session.id }),
        catch: () => "failed" as const,
      }).pipe(
        Effect.tap(() => respond(socket, input.id)),
        Effect.catch(() => respond(socket, input.id, "interrupt failed")),
      )
    }),
  )
}

function localSession(ctx: RemoteSessionContext, client: Pick<OpenCodeClient, "session">, id: string) {
  return Effect.promise(() => client.session.get({ sessionID: id }).catch(() => undefined)).pipe(
    Effect.map((session) => (session && sameLocation(session.location, ctx.location) ? session : undefined)),
  )
}

async function createDirectory(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "session">,
  sessionID: string | undefined,
  requested: string | undefined,
) {
  if (requested !== undefined) {
    const directory = await resolveUnderLaunch(ctx.location.directory, requested)
    return directory === ctx.location.directory ? directory : undefined
  }
  if (sessionID === undefined) return ctx.location.directory
  const session = await client.session.get({ sessionID })
  if (!sameLocation(session.location, ctx.location)) return
  return session.location.directory
}

async function resolveUnderLaunch(launchDirectory: string, requested: string) {
  if (isAbsolute(requested)) return
  const paths = await Promise.all([realpath(launchDirectory), realpath(resolve(launchDirectory, requested))]).catch(
    () => [],
  )
  const [launch, target] = paths
  if (!launch || !target) return
  const path = relative(launch, target)
  if (path === "" || (!path.startsWith("..") && !isAbsolute(path))) return target
}

function sameLocation(
  left: { readonly directory: string; readonly workspaceID?: string },
  right: RemoteSessionContext["location"],
) {
  return left.directory === right.directory && left.workspaceID === right.workspaceID
}

function isLifecycleEvent(type: string): type is LifecycleEvent {
  return (
    type === "session.execution.started" ||
    type === "session.execution.succeeded" ||
    type === "session.execution.failed" ||
    type === "session.execution.interrupted"
  )
}

function respond(socket: RelaySocket, id: string, result?: unknown) {
  return Effect.sync(() =>
    send(
      socket,
      result === undefined || typeof result === "string"
        ? { type: "response", id, ...(typeof result === "string" ? { error: result } : { result: {} }) }
        : { type: "response", id, result },
    ),
  )
}

function send(socket: RelaySocket, data: RemoteOutbound) {
  socket.send(data)
}

function listDirectories(
  ctx: RemoteSessionContext,
  socket: RelaySocket,
  input: Extract<RemoteInbound, { type: "command" }>,
) {
  const parsed = RemoteDirectoryListSchema.safeParse(input.data)
  if (!parsed.success) return respond(socket, input.id, "invalid list_directories request")
  return Effect.tryPromise({
    try: async () => {
      const launch = await realpath(ctx.location.directory)
      const listed = await resolveUnderLaunch(launch, parsed.data.path ?? ".")
      if (!listed) return { type: "invalid" as const }
      const entries = await readdir(listed, { withFileTypes: true })
      const directories: { name: string; path: string }[] = []
      for (const entry of entries) {
        if (directories.length >= 256) break
        const child = await realpath(resolve(listed, entry.name)).catch(() => undefined)
        if (!child || !contains(launch, child)) continue
        const info = await stat(child).catch(() => undefined)
        if (!info?.isDirectory()) continue
        const path = relative(launch, child).split(sep).join("/")
        if (path) directories.push({ name: entry.name, path })
      }
      return {
        type: "success" as const,
        result: { protocolVersion: 1, path: relative(launch, listed).split(sep).join("/"), directories },
      }
    },
    catch: () => ({ type: "failed" as const }),
  }).pipe(
    Effect.flatMap((result) => {
      if (result.type === "success") return respond(socket, input.id, result.result)
      if (result.type === "invalid") return respond(socket, input.id, "invalid list_directories path")
      return respond(socket, input.id, "failed to list directories")
    }),
  )
}

function dropQueuedMessage(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "session">,
  socket: RelaySocket,
  admitted: Map<string, string>,
  input: Extract<RemoteInbound, { type: "command" }>,
) {
  const parsed = RemoteDropQueuedMessageSchema.safeParse(input.data)
  if (!parsed.success || !input.sessionId) return respond(socket, input.id, "invalid drop_queued_message command")
  return localSession(ctx, client, input.sessionId).pipe(
    Effect.flatMap((session) => {
      if (!session) return respond(socket, input.id, "session unavailable")
      if (admitted.get(parsed.data.messageID) !== session.id) return respond(socket, input.id, "message not queued")
      return Effect.tryPromise({
        try: () => client.session.inbox.cancel({ sessionID: session.id, inboxID: parsed.data.messageID }),
        catch: () => "failed" as const,
      }).pipe(
        Effect.tap(() => Effect.sync(() => admitted.delete(parsed.data.messageID))),
        Effect.andThen(respond(socket, input.id)),
        Effect.catch(() => respond(socket, input.id, "message not queued")),
      )
    }),
  )
}

function contains(parent: string, child: string) {
  const path = relative(parent, child)
  return path === "" || (!path.startsWith("..") && !isAbsolute(path))
}
