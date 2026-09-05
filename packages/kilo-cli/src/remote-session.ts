import type { OpenCodeClient } from "@opencode-ai/client"
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
  RemoteRenameSchema,
  RemoteSendCommandSchema,
  RemoteTextMessageSchema,
  type RemoteInbound,
  type RemoteOutbound,
} from "./remote-protocol"

export type RemoteSessionConnection = {
  /** Explicit relay origin. Production must use HTTPS; tests may opt into loopback HTTP. */
  readonly relayURL: string
  /** Resolved by the host's validated Kilo account callback; never read from env or storage here. */
  readonly bearerToken: string
  /** The authenticated local public client supplied by the host at plugin activation. */
  readonly client: () => Pick<OpenCodeClient, "command" | "session">
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
  client: Pick<OpenCodeClient, "command" | "session">,
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
  return Effect.promise(async () => {
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
  }).pipe(Effect.catch(() => Effect.void))
}

function inbound(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "command" | "session">,
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
        ? Effect.promise(() => client.session.rename({ sessionID: session.id, title: parsed.data.title }))
        : Effect.void,
    ),
    Effect.catch(() => Effect.void),
  )
}

function sendMessage(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "session">,
  socket: RelaySocket,
  admitted: Map<string, string>,
  input: Extract<RemoteInbound, { type: "command" }>,
) {
  const parsed = RemoteTextMessageSchema.safeParse(input.data)
  if (!parsed.success) return respond(socket, input.id, "unsupported send_message payload")
  return localSession(ctx, client, parsed.data.sessionID).pipe(
    Effect.flatMap((session) => {
      if (!session) return respond(socket, input.id, "session unavailable")
      return Effect.promise(() =>
        client.session.prompt({
          sessionID: session.id,
          text: parsed.data.parts[0].text,
          ...(parsed.data.messageID === undefined ? {} : { id: parsed.data.messageID }),
        }),
      ).pipe(
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
      return Effect.promise(() => client.command.list({ location: session.location })).pipe(
        Effect.flatMap((commands) => {
          if (!commands.data.some((command) => command.name === parsed.data.command)) {
            return respond(socket, input.id, "unknown slash command")
          }
          return Effect.promise(() =>
            client.session.command({
              sessionID: session.id,
              command: parsed.data.command,
              text: parsed.data.arguments,
            }),
          ).pipe(
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
      return Effect.promise(() => client.command.list({ location: session.location })).pipe(
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
      return Effect.promise(() => client.session.interrupt({ sessionID: session.id })).pipe(
        Effect.tap(() => respond(socket, input.id)),
        Effect.catch(() => respond(socket, input.id, "interrupt failed")),
      )
    }),
  )
}

function localSession(ctx: RemoteSessionContext, client: Pick<OpenCodeClient, "session">, id: string) {
  return Effect.promise(() => client.session.get({ sessionID: id })).pipe(
    Effect.map((session) => (sameLocation(session.location, ctx.location) ? session : undefined)),
    Effect.catch(() => Effect.succeed(undefined)),
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
      return Effect.promise(() =>
        client.session.inbox.cancel({ sessionID: session.id, inboxID: parsed.data.messageID }),
      ).pipe(
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
