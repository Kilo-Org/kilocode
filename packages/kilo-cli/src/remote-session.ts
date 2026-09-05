import type { OpenCodeClient } from "@opencode-ai/client"
import type { Context, Plugin } from "@opencode-ai/plugin/effect/plugin"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect, PubSub, Stream } from "effect"
import { realpath } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import {
  RemoteCommandListSchema,
  RemoteCreateSessionSchema,
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

/** Connect the explicit v1 relay transport to the authenticated public v2 client. */
export function createRemoteSessionPlugin(connection: RemoteSessionConnection): Plugin {
  validateConnection(connection)
  return define({
    id: "kilocode.remote-session",
    effect: (ctx) => installRemoteSessionAdapter(ctx, connection, connection.client()),
  })
}

export function installRemoteSessionAdapter(
  ctx: Context,
  connection: Omit<RemoteSessionConnection, "client">,
  client: Pick<OpenCodeClient, "command" | "session">,
) {
  return Effect.gen(function* () {
    const events = yield* PubSub.unbounded<AdapterEvent>()
    const socket = connect(connection, (event) => {
      if (event.type === "inbound") {
        void Effect.runPromise(inbound(ctx, client, socket, event.data))
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
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* Stream.fromPubSub(events).pipe(
      Stream.runForEach(() => heartbeat(ctx, client, socket)),
      Effect.forkScoped({ startImmediately: true }),
    )
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

function connect(connection: Omit<RemoteSessionConnection, "client">, offer: (event: AdapterEvent) => void) {
  const url = new URL(connection.relayURL)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/api/user/cli"
  url.searchParams.set("token", connection.bearerToken)
  url.searchParams.set("connectionId", crypto.randomUUID())
  const socket = new WebSocket(url)
  socket.onopen = () => offer({ type: "heartbeat" })
  socket.onmessage = (event) => {
    try {
      const value = RemoteInboundSchema.safeParse(JSON.parse(String(event.data)))
      if (value.success) offer({ type: "inbound", data: value.data })
    } catch {
      // Invalid relay frames are ignored without reflecting their raw content.
    }
  }
  return socket
}

function heartbeat(ctx: Context, client: Pick<OpenCodeClient, "session">, socket: WebSocket) {
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
  ctx: Context,
  client: Pick<OpenCodeClient, "command" | "session">,
  socket: WebSocket,
  input: RemoteInbound,
) {
  if (input.type === "subscribe" || input.type === "unsubscribe" || input.type === "heartbeat_ack") {
    return heartbeat(ctx, client, socket)
  }
  if (input.type === "system") return rename(ctx, client, input.data)
  if (input.command === "send_message") return sendMessage(ctx, client, socket, input)
  if (input.command === "send_command") return sendCommand(ctx, client, socket, input)
  if (input.command === "list_commands") return listCommands(ctx, client, socket, input)
  if (input.command === "create_session") return createSession(ctx, client, socket, input)
  if (input.command === "interrupt") return interrupt(ctx, client, socket, input)
  return Effect.sync(() =>
    send(socket, { type: "response", id: input.id, error: `unsupported command: ${input.command}` }),
  )
}

function rename(ctx: Context, client: Pick<OpenCodeClient, "session">, data: unknown) {
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
  ctx: Context,
  client: Pick<OpenCodeClient, "session">,
  socket: WebSocket,
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
        Effect.tap(() => respond(socket, input.id)),
        Effect.catch(() => respond(socket, input.id, "failed to admit message")),
      )
    }),
  )
}

function sendCommand(
  ctx: Context,
  client: Pick<OpenCodeClient, "session">,
  socket: WebSocket,
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
      return Effect.promise(() =>
        client.session.command({ sessionID: session.id, command: parsed.data.command, text: parsed.data.arguments }),
      ).pipe(
        Effect.tap(() => respond(socket, input.id)),
        Effect.catch(() => respond(socket, input.id, "failed to admit command")),
      )
    }),
  )
}

function listCommands(
  ctx: Context,
  client: Pick<OpenCodeClient, "command" | "session">,
  socket: WebSocket,
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
  ctx: Context,
  client: Pick<OpenCodeClient, "session">,
  socket: WebSocket,
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
  ctx: Context,
  client: Pick<OpenCodeClient, "session">,
  socket: WebSocket,
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

function localSession(ctx: Context, client: Pick<OpenCodeClient, "session">, id: string) {
  return Effect.promise(() => client.session.get({ sessionID: id })).pipe(
    Effect.map((session) => (sameLocation(session.location, ctx.location) ? session : undefined)),
    Effect.catch(() => Effect.succeed(undefined)),
  )
}

async function createDirectory(
  ctx: Context,
  client: Pick<OpenCodeClient, "session">,
  sessionID: string | undefined,
  requested: string | undefined,
) {
  if (requested !== undefined) return resolveUnderLaunch(ctx.location.directory, requested)
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

function sameLocation(left: { readonly directory: string; readonly workspaceID?: string }, right: Context["location"]) {
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

function respond(socket: WebSocket, id: string, result?: unknown) {
  return Effect.sync(() =>
    send(
      socket,
      result === undefined || typeof result === "string"
        ? { type: "response", id, ...(typeof result === "string" ? { error: result } : { result: {} }) }
        : { type: "response", id, result },
    ),
  )
}

function send(socket: WebSocket, data: RemoteOutbound) {
  if (socket.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify(data))
}
