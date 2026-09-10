import type { FormInfo, ModelInfo, OpenCodeClient, PermissionRequest, ProviderInfo } from "@opencode-ai/client"
import type { Context, Plugin } from "@opencode-ai/plugin/effect/plugin"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { PermissionV1 } from "@opencode-ai/schema/v1/permission"
import { QuestionV1 } from "@opencode-ai/schema/v1/question"
import { Effect, Option, PubSub, Schema, Scope, Stream } from "effect"
import { readdir, realpath, stat } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { createRemoteTranscript, transcriptFrames, type TranscriptFrame } from "./remote-transcript"
import type { RemoteSuggestions, RemoteSuggestionsUpdate } from "./remote-suggestions"
import {
  createRemoteStatus,
  forgetSession,
  invalidatesQueue,
  pendingUserQueue,
  queueFrames,
  queueReplayFrames,
  statusFrames,
  type StatusFrame,
} from "./remote-status"
import {
  RemoteCommandListSchema,
  RemoteCreateSessionSchema,
  RemoteDirectoryListSchema,
  RemoteDropQueuedMessageSchema,
  RemoteExitSchema,
  RemoteInboundSchema,
  RemoteModelListSchema,
  RemoteMultipartMessageSchema,
  RemoteQuestionRejectSchema,
  RemoteQuestionReplySchema,
  RemotePermissionRespondSchema,
  RemoteRenameSchema,
  RemoteSendCommandSchema,
  RemoteSuggestionAcceptSchema,
  RemoteSuggestionDismissSchema,
  type RemoteInbound,
  type RemoteMessagePart,
  type RemoteOutbound,
} from "./remote-protocol"

/**
 * The host normally supplies a full public client; the model and provider
 * namespaces stay optional so pre-catalog hosts can still run the session
 * relay. list_models degrades to an explicit error without them. Permission
 * and form namespaces stay optional for the same reason: without them the
 * adapter neither forwards permission/question events nor answers their
 * commands.
 */
export type RemoteSessionClient = Pick<OpenCodeClient, "command" | "session"> &
  Partial<Pick<OpenCodeClient, "model" | "provider" | "permission" | "form" | "message" | "project">>

export type RemoteSessionConnection = {
  /** Explicit relay origin. Production must use HTTPS; tests may opt into loopback HTTP. */
  readonly relayURL: string
  /** Resolved by the host's validated Kilo account callback; never read from env or storage here. */
  readonly bearerToken: string
  /** The authenticated local public client supplied by the host at plugin activation. */
  readonly client: () => RemoteSessionClient
  readonly allowHttpLoopback?: boolean
}

type AdapterEvent =
  | { readonly type: "heartbeat" }
  | { readonly type: "reconnected" }
  | { readonly type: "inbound"; readonly data: RemoteInbound }
  | { readonly type: "suggestion"; readonly update: RemoteSuggestionsUpdate }
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
    effect: (ctx) =>
      Effect.gen(function* () {
        // The plugin form is an always-enabled remote adapter: the suggest
        // tool registers on the full plugin context for the plugin's
        // lifetime, and its holder drives the adapter's suggestion lane.
        const { createRemoteSuggestions, suggestTool } = yield* Effect.promise(() => import("./remote-suggestions"))
        const suggestions = createRemoteSuggestions()
        yield* ctx.tool.transform((editor) => {
          editor.add(suggestTool({ suggestions, client: connection.client() }))
        })
        yield* installRemoteSessionAdapter(ctx, connection, connection.client(), suggestions).pipe(Effect.asVoid)
      }),
  })
}

export function installRemoteSessionAdapter(
  ctx: RemoteSessionContext,
  connection: Omit<RemoteSessionConnection, "client">,
  client: RemoteSessionClient,
  suggestions?: RemoteSuggestions,
): Effect.Effect<RemoteSessionHandle, never, Scope.Scope> {
  validateConnection(connection)
  return Effect.gen(function* () {
    const events = yield* PubSub.unbounded<AdapterEvent>()
    const subscribed = new Set<string>()
    const epochs = new Map<string, number>()
    const terminals = new Map<string, number>()
    const questions = new Map<string, FormInfo>()
    // Sessions detached by exit_cli: excluded from every subsequent heartbeat,
    // which is what the deployed relay reads as ownership release. Process-local
    // like every other adapter state; a host restart re-advertises from public
    // session state.
    const detached = new Set<string>()
    const transcript = createRemoteTranscript()
    const status = createRemoteStatus()
    // Bumped on every disconnect: in-flight replays capture it and abort, so
    // buffered frames cannot duplicate the reconnect replay's snapshot.
    let transport = 0
    const socket = connect(
      connection,
      (event) => {
        if (event.type === "inbound") {
          void Effect.runPromise(
            inbound(
              ctx,
              client,
              socket,
              subscribed,
              epochs,
              terminals,
              () => transport,
              questions,
              status,
              detached,
              suggestions,
              event.data,
            ),
          )
          return
        }
        PubSub.publishUnsafe(events, event)
      },
      () => {
        transport++
      },
    )
    const interval = setInterval(() => {
      PubSub.publishUnsafe(events, { type: "heartbeat" })
    }, 10_000)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        clearInterval(interval)
        socket.close()
      }),
    )
    if (suggestions) {
      // The viewer-eligibility gate (board 111): remote enabled at the Location
      // does not mean a viewer subscribed to every local session. The holder
      // refuses to show a card for a session outside the adapter's validated
      // subscription scope, so an unsubscribed local session's producer fails
      // promptly instead of hanging on an invisible card.
      suggestions.setEligibility((sessionID) =>
        Effect.runPromise(
          subscribedRoot(ctx, client, subscribed, sessionID).pipe(Effect.map((owner) => owner !== undefined)),
        ).catch(() => false),
      )
      // Suggestion holder updates become relay frames through the adapter's
      // sequential event stream, so shown/accepted/dismissed ordering with
      // other lanes is preserved. Disposal on scope close rejects every
      // pending suggestion (disable cleanup).
      const unsubscribe = suggestions.onUpdate((update) => PubSub.publishUnsafe(events, { type: "suggestion", update }))
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          unsubscribe()
          suggestions.dispose()
        }),
      )
      // v1 SessionPrompt parity (ecccd1f kilocode/suggestion/index.ts): a newly
      // queued prompt on the session auto-dismisses its pending suggestion
      // cards. The public inbox-enqueued event is the v2 admission signal.
      yield* ctx.event.subscribe().pipe(
        Stream.filter((event) => event.type === "session.inbox.enqueued"),
        Stream.runForEach((event) =>
          Effect.sync(() => {
            const sessionID = frameSessionID(event.data)
            if (sessionID !== undefined) suggestions.dismissAll(sessionID)
          }),
        ),
        Effect.catch(() => Effect.void),
        Effect.forkScoped({ startImmediately: true }),
      )
    }
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
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => isTranslationEvent(event.type)),
      Stream.runForEach((event) =>
        forwardEvent(
          ctx,
          client,
          socket,
          subscribed,
          epochs,
          () => transport,
          terminals,
          questions,
          transcript,
          status,
          event,
        ),
      ),
      Effect.catch(() => Effect.void),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* Stream.fromPubSub(events).pipe(
      Stream.runForEach((event) =>
        event.type === "inbound"
          ? inbound(
              ctx,
              client,
              socket,
              subscribed,
              epochs,
              terminals,
              () => transport,
              questions,
              status,
              detached,
              suggestions,
              event.data,
            )
          : event.type === "suggestion"
            ? (suggestions
                ? suggestionFrames(ctx, client, socket, subscribed, terminals, suggestions, event.update)
                : Effect.void)
            : heartbeat(ctx, client, socket, detached).pipe(
                Effect.andThen(
                  event.type === "reconnected"
                    ? replaySubscribed(
                        ctx,
                        client,
                        socket,
                        subscribed,
                        epochs,
                        terminals,
                        () => transport,
                        questions,
                        status,
                        suggestions,
                      )
                    : Effect.void,
                ),
              ),
      ),
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
  onDisconnect?: () => void,
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
        offer({ type: "reconnected" })
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
        // A disconnect invalidates in-flight replays immediately: frames they
        // would emit now buffer and would duplicate the fresh replay the
        // reconnect schedules.
        onDisconnect?.()
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

function heartbeat(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "session">,
  socket: RelaySocket,
  detached: ReadonlySet<string>,
) {
  return Effect.tryPromise({
    try: async () => {
      const [listed, active] = await Promise.all([
        client.session.list({ directory: ctx.location.directory, workspace: ctx.location.workspaceID }),
        client.session.active(),
      ])
      send(socket, {
        type: "heartbeat",
        // Backed by the existing send_message inline data-URL attachment path:
        // the deployed consumer enables its attachment UI only when the
        // owning CLI's heartbeat row advertises this (v1 producer contract,
        // ecccd1f remote-ws.ts; consumer cloud origin/main cloud-agent-sdk
        // activeSessionSchema → publishCapabilities → mobile fail-closed
        // gate). sessionClone stays absent while clone is refused.
        capabilities: { attachments: true },
        sessions: listed.data.flatMap((session) => {
          if (!sameLocation(session.location, ctx.location) || !session.title || detached.has(session.id)) return []
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
  subscribed: Set<string>,
  epochs: Map<string, number>,
  terminals: Map<string, number>,
  transport: () => number,
  questions: Map<string, FormInfo>,
  status: ReturnType<typeof createRemoteStatus>,
  detached: Set<string>,
  suggestions: RemoteSuggestions | undefined,
  input: RemoteInbound,
) {
  if (input.type === "subscribe") {
    return subscribeSession(
      ctx,
      client,
      socket,
      subscribed,
      epochs,
      terminals,
      transport,
      questions,
      status,
      detached,
      input.sessionId,
    )
  }
  if (input.type === "unsubscribe") {
    // Bump the epoch synchronously so an in-flight subscribe or its replay
    // observes the supersession and stops.
    epochs.set(input.sessionId, (epochs.get(input.sessionId) ?? 0) + 1)
    subscribed.delete(input.sessionId)
    // The advertise bookkeeping lives exactly as long as the subscription.
    forgetSession(status, input.sessionId)
    return heartbeat(ctx, client, socket, detached)
  }
  if (input.type === "heartbeat_ack") {
    return heartbeat(ctx, client, socket, detached)
  }
  if (input.type === "system") return rename(ctx, client, input.data)
  if (input.command === "send_message") return sendMessage(ctx, client, socket, input)
  if (input.command === "send_command") return sendCommand(ctx, client, socket, input)
  if (input.command === "list_directories") return listDirectories(ctx, socket, input)
  if (input.command === "list_commands") return listCommands(ctx, client, socket, input)
  if (input.command === "list_models") return listModels(ctx, client, socket, input)
  if (input.command === "create_session") return createSession(ctx, client, socket, detached, input)
  if (input.command === "interrupt") return interrupt(ctx, client, socket, input)
  if (input.command === "exit_cli") return exitSession(ctx, client, socket, detached, input)
  if (input.command === "suggestion_accept") return suggestionReply(ctx, client, socket, subscribed, suggestions, input, true)
  if (input.command === "suggestion_dismiss") return suggestionReply(ctx, client, socket, subscribed, suggestions, input, false)
  if (input.command === "drop_queued_message") return dropQueuedMessage(ctx, client, socket, status, input)
  if (input.command === "permission_respond") return permissionRespond(ctx, client, socket, input)
  if (input.command === "question_reply") return questionReply(ctx, client, socket, input)
  if (input.command === "question_reject") return questionReject(ctx, client, socket, input)
  return Effect.sync(() =>
    send(socket, { type: "response", id: input.id, error: `unsupported command: ${input.command}` }),
  )
}

function subscribeSession(
  ctx: RemoteSessionContext,
  client: RemoteSessionClient,
  socket: RelaySocket,
  subscribed: Set<string>,
  epochs: Map<string, number>,
  terminals: Map<string, number>,
  transport: () => number,
  questions: Map<string, FormInfo>,
  status: ReturnType<typeof createRemoteStatus>,
  detached: Set<string>,
  sessionID: string,
) {
  // The relay resends subscribe frames on reconnect while the subscription is
  // still active: a duplicate must not replay the pending snapshot again.
  if (subscribed.has(sessionID)) return heartbeat(ctx, client, socket, detached)
  const epoch = (epochs.get(sessionID) ?? 0) + 1
  epochs.set(sessionID, epoch)
  const capturedTransport = transport()
  return localSession(ctx, client, sessionID).pipe(
    Effect.flatMap((session) => {
      // An immediate unsubscribe bumped the epoch while the location check was
      // in flight: this subscribe attempt is superseded and must not claim the
      // session or start its replay.
      const superseded = epochs.get(sessionID) !== epoch
      if (session && !superseded) subscribed.add(sessionID)
      // Foreign-location subscribes are ignored beyond the heartbeat: the
      // adapter never forwards events for sessions it does not own.
      return heartbeat(ctx, client, socket, detached).pipe(
        Effect.andThen(
          session && !superseded
            ? Effect.all([
                replayPending(
                  ctx,
                  client,
                  socket,
                  subscribed,
                  questions,
                  terminals,
                  sessionID,
                  () => epochs.get(sessionID) === epoch && subscribed.has(sessionID),
                  transport,
                ),
                replayQueues(
                  ctx,
                  client,
                  socket,
                  status,
                  sessionID,
                  () =>
                    epochs.get(sessionID) === epoch && subscribed.has(sessionID) && transport() === capturedTransport,
                ),
              ]).pipe(Effect.asVoid)
            : Effect.void,
        ),
      )
    }),
    Effect.catch(() => heartbeat(ctx, client, socket, detached)),
  )
}

function replaySubscribed(
  ctx: RemoteSessionContext,
  client: RemoteSessionClient,
  socket: RelaySocket,
  subscribed: Set<string>,
  epochs: Map<string, number>,
  terminals: Map<string, number>,
  transport: () => number,
  questions: Map<string, FormInfo>,
  status: ReturnType<typeof createRemoteStatus>,
  suggestions: RemoteSuggestions | undefined,
) {
  return Effect.forEach(
    [...subscribed],
    (sessionID) => {
      const epoch = epochs.get(sessionID)
      const capturedTransport = transport()
      return Effect.all([
        replayPending(
          ctx,
          client,
          socket,
          subscribed,
          questions,
          terminals,
          sessionID,
          // Capture the epoch: a resubscribe after an unsubscribe must not let
          // this reconnect replay double-emit alongside the new one.
          () => epochs.get(sessionID) === epoch && subscribed.has(sessionID),
          transport,
        ),
        replayQueues(
          ctx,
          client,
          socket,
          status,
          sessionID,
          () => epochs.get(sessionID) === epoch && subscribed.has(sessionID) && transport() === capturedTransport,
        ),
        suggestions
          ? replaySuggestions(ctx, client, socket, subscribed, terminals, suggestions, sessionID)
          : Effect.void,
      ]).pipe(Effect.asVoid)
    },
    { discard: true },
  ).pipe(Effect.catch(() => Effect.void))
}

/**
 * Replay still-pending suggestion cards on reconnect (v1 replay parity, ecccd1f
 * remote-sender.ts :511-530): a newly-subscribed client must see suggestions
 * that were shown before it connected. The holder's pending list is
 * process-local; terminal bumps invalidate entries settled after the snapshot
 * so a replayed shown frame can never resurrect a settled card, and the accept
 * idempotence ("not found") guarantees no duplicate follow-up prompt.
 */
function replaySuggestions(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "session">,
  socket: RelaySocket,
  subscribed: Set<string>,
  terminals: Map<string, number>,
  suggestions: RemoteSuggestions,
  sessionID: string,
) {
  return Effect.gen(function* () {
    for (const item of suggestions.pending()) {
      const owner = yield* subscribedRoot(ctx, client, subscribed, item.sessionID)
      const self = item.sessionID === sessionID
      if (!owner || (!self && owner.parent !== sessionID)) continue
      if (terminals.get(`suggestion:${item.id}`) !== undefined) continue
      send(
        socket,
        eventFrame(
          item.sessionID,
          owner.parent === undefined || owner.parent === item.sessionID ? undefined : owner.parent,
          "suggestion.shown",
          {
            id: item.id,
            sessionID: item.sessionID,
            text: item.text,
            actions: item.actions,
            ...(item.tool === undefined ? {} : { tool: item.tool }),
          },
        ),
      )
    }
  }).pipe(Effect.catch(() => Effect.void))
}

/**
 * Replay the authoritative pending queue for a subscription: the subscribed
 * session and every same-location descendant whose live queue this adapter also
 * advertises, so a reconnect reconciles exactly the set it can emit. Descendant
 * frames keep the subscribed root as their parent, matching the live lane.
 */
function replayQueues(
  ctx: RemoteSessionContext,
  client: RemoteSessionClient,
  socket: RelaySocket,
  status: ReturnType<typeof createRemoteStatus>,
  sessionID: string,
  isActive: () => boolean,
) {
  return Effect.gen(function* () {
    const targets = [sessionID, ...(yield* descendantSessions(ctx, client, sessionID))]
    for (const target of targets) {
      if (!isActive()) return
      const frames = yield* Effect.promise(() => queueReplayFrames(status, client, target, isActive))
      for (const frame of frames) {
        send(
          socket,
          eventFrame(frame.sessionId, frame.sessionId === sessionID ? undefined : sessionID, frame.event, frame.data),
        )
      }
    }
  }).pipe(Effect.catchCause(() => Effect.void))
}

/**
 * The session that actually holds a pending inbox item, resolved from public
 * state only: the command session itself, or the same-location descendant that
 * has it pending. The reachable set is exactly the set whose queues are
 * advertised under this command session as a subscribed root, so every
 * advertised id is cancellable by root id — including one admitted by another
 * client, after a restart, or beyond any page of siblings.
 */
export function resolveQueueOwner(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "session">,
  commandSession: string,
  messageID: string,
) {
  return Effect.gen(function* () {
    const own = yield* Effect.promise(() => pendingUserQueue(client, commandSession))
    if ((own ?? []).includes(messageID)) return commandSession
    for (const candidate of yield* descendantSessions(ctx, client, commandSession)) {
      const queue = yield* Effect.promise(() => pendingUserQueue(client, candidate))
      if ((queue ?? []).includes(messageID)) return candidate
    }
    return undefined
  })
}

/**
 * The only bound on descendant reachability: the same 8 parent edges
 * `subscribedRoot` accepts when it walks the other way. Nothing caps breadth,
 * because the forwarding side does not either — a session is advertised under a
 * subscribed root exactly when at most 8 same-location parent edges separate
 * them, and this walk enumerates precisely that set.
 */
const DESCENDANT_HOPS = 8
/** Page size for the public listing; pages are followed to exhaustion, never dropped. */
const DESCENDANT_PAGE = 100

/**
 * Same-location descendants, breadth-first over the public `parentID` listing
 * with the cursor followed to exhaustion. Location is validated per node, so a
 * moved child is not treated as part of this location's subscription.
 *
 * The cost is proportional to the real descendant tree; it is paid on explicit
 * subscribe/reconnect replay and on an explicit root-ID cancellation, never per
 * forwarded event.
 */
function descendantSessions(ctx: RemoteSessionContext, client: Pick<OpenCodeClient, "session">, sessionID: string) {
  return Effect.promise(async () => {
    const found: string[] = []
    const seen = new Set<string>([sessionID])
    let frontier = [sessionID]
    for (let hop = 0; hop < DESCENDANT_HOPS && frontier.length > 0; hop++) {
      const next: string[] = []
      for (const parent of frontier) {
        let cursor: string | undefined
        do {
          const page = await client.session
            .list({
              parentID: parent,
              limit: DESCENDANT_PAGE,
              ...(cursor === undefined ? {} : { cursor }),
            })
            .catch(() => undefined)
          if (page === undefined) break
          for (const child of page.data) {
            if (seen.has(child.id)) continue
            seen.add(child.id)
            if (!sameLocation(child.location, ctx.location)) continue
            found.push(child.id)
            next.push(child.id)
          }
          cursor = page.cursor.next ?? undefined
        } while (cursor !== undefined)
      }
      frontier = next
    }
    return found
  }).pipe(Effect.catch(() => Effect.succeed([] as string[])))
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
  client: RemoteSessionClient,
  socket: RelaySocket,
  input: Extract<RemoteInbound, { type: "command" }>,
) {
  const parsed = RemoteMultipartMessageSchema.safeParse(input.data)
  if (!parsed.success) return respond(socket, input.id, "unsupported send_message payload")
  const texts = parsed.data.parts.filter(
    (part): part is Extract<RemoteMessagePart, { type: "text" }> => part.type === "text",
  )
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
            // v1 always advertises this producer contract (ecccd1f
            // remote-command.ts build()): exit_cli is interpreted as
            // session-detach, independently of any interactive process-exit
            // seam. The deployed consumer gates its exit flow on it.
            canExitSession: true,
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
          Effect.flatMap((session) => (session ? Effect.succeed(session.model) : Effect.fail("session unavailable"))),
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
          ...(current.variant === undefined || current.variant === "default" ? {} : { variant: current.variant }),
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
  detached: Set<string>,
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
      return heartbeat(ctx, client, socket, detached).pipe(
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

/**
 * v1 exit_cli is session-detach (ecccd1f remote-sender.ts): verify ownership,
 * cancel the session's active prompt, then stop advertising the session — the
 * fresh heartbeat without the id is what the deployed relay reads as ownership
 * release. The adapter process stays alive afterwards: v2 has no RemoteExit
 * seam, which is exactly v1's headless path (ACK and keep the host alive, the
 * host keeps advertising and can create a new session from zero).
 */
function exitSession(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "session">,
  socket: RelaySocket,
  detached: Set<string>,
  input: Extract<RemoteInbound, { type: "command" }>,
) {
  const parsed = RemoteExitSchema.safeParse(input.data)
  if (!parsed.success || !input.sessionId) return respond(socket, input.id, "invalid exit_cli command")
  return localSession(ctx, client, input.sessionId).pipe(
    Effect.flatMap((session) => {
      // v1's ownership gate (hasSession): a session this adapter no longer
      // advertises — unknown, foreign, or already detached — is not detached
      // here, and the refusal leaves presence untouched.
      if (!session || detached.has(session.id)) return respond(socket, input.id, "session not owned by this CLI")
      return Effect.tryPromise({
        // Awaiting the cancel mirrors v1 step 3: the user must not see a
        // "still working" indicator after they leave. v2 interruption of an
        // idle session is a no-op. Failure refuses the ACK and leaves the
        // session advertised, like v1's roll-back path.
        try: () => client.session.interrupt({ sessionID: session.id }),
        catch: () => "failed" as const,
      }).pipe(
        Effect.andThen(() => {
          detached.add(session.id)
          // The detach fence: the heartbeat that no longer contains the id is
          // sent before the ACK, so the relay sees the ownership release even
          // if the ACK were lost. A failed heartbeat send is retried by the
          // next tick, which reads the same detached set.
          return heartbeat(ctx, client, socket, detached)
        }),
        Effect.andThen(respond(socket, input.id)),
        Effect.catch(() => respond(socket, input.id, "failed to exit session")),
      )
    }),
  )
}

// v1 suggestion_accept/suggestion_dismiss parity (ecccd1f remote-sender.ts
// :1263-1299): the pending entry is resolved by requestID, its session must be
// adapter-owned and either the relay-routed session or a validated descendant
// of it, and accept additionally validates the action index. An unknown
// requestID or invalid index is v1's exact "not found" error; dismiss of an
// unknown id is an idempotent no-op success.
function suggestionReply(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "session">,
  socket: RelaySocket,
  subscribed: Set<string>,
  suggestions: RemoteSuggestions | undefined,
  input: Extract<RemoteInbound, { type: "command" }>,
  accept: boolean,
) {
  if (!suggestions) return respond(socket, input.id, "suggestions unavailable")
  if (accept) {
    const parsed = RemoteSuggestionAcceptSchema.safeParse(input.data)
    if (!parsed.success) return respond(socket, input.id, "invalid suggestion_accept data")
    return settleSuggestion(ctx, client, socket, subscribed, suggestions, input, parsed.data.requestID, parsed.data.index)
  }
  const parsed = RemoteSuggestionDismissSchema.safeParse(input.data)
  if (!parsed.success) return respond(socket, input.id, "invalid suggestion_dismiss data")
  return settleSuggestion(ctx, client, socket, subscribed, suggestions, input, parsed.data.requestID, undefined)
}

function settleSuggestion(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "session">,
  socket: RelaySocket,
  subscribed: Set<string>,
  suggestions: RemoteSuggestions,
  input: Extract<RemoteInbound, { type: "command" }>,
  requestID: string,
  index: number | undefined,
) {
  const pending = suggestions.find(requestID)
  if (!pending) {
    // v1 parity: an unknown accept is the "not found" error; an unknown
    // dismiss is an idempotent no-op success.
    return index === undefined ? respond(socket, input.id) : respond(socket, input.id, "suggestion not found or invalid action index")
  }
  return subscribedRoot(ctx, client, subscribed, pending.sessionID).pipe(
    Effect.flatMap((owner) => {
      // Session ownership: the pending must live in this adapter's validated
      // subscription scope, and the relay-routed session must be the pending's
      // session or its subscribed ancestor (the consumer accepts from the
      // session it is configured on, which may be the subtree's root).
      const routed = input.sessionId ?? pending.sessionID
      if (!owner || (pending.sessionID !== routed && owner.parent !== routed)) {
        return respond(socket, input.id, "session unavailable")
      }
      // A concurrent dismiss between the lookup and here — a queued prompt, a
      // second command, or an interrupt — settles first and this settle
      // refuses instead of double-resolving.
      const settled = index !== undefined ? suggestions.accept(requestID, index) : suggestions.dismiss(requestID)
      if (!settled) return respond(socket, input.id, "suggestion not found or invalid action index")
      return respond(socket, input.id)
    }),
    Effect.catch(() => respond(socket, input.id, "suggestion not found or invalid action index")),
  )
}

/**
 * Holder updates become relay event frames, ownership-gated like every other
 * lane: shown for a pending card, accepted/dismissed when the card settles.
 * Terminal bumps invalidate any in-flight reconnect replay of the settled id
 * so a replayed shown frame can never resurrect a settled suggestion.
 */
function suggestionFrames(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "session">,
  socket: RelaySocket,
  subscribed: Set<string>,
  terminals: Map<string, number>,
  suggestions: RemoteSuggestions,
  update: RemoteSuggestionsUpdate,
) {
  const sessionID = update.type === "shown" ? update.suggestion.sessionID : update.sessionID
  const requestID = update.type === "shown" ? update.suggestion.id : update.requestID
  if (update.type !== "shown") bumpTerminal(terminals, `suggestion:${requestID}`)
  return subscribedRoot(ctx, client, subscribed, sessionID).pipe(
    Effect.flatMap((owner) => {
      if (!owner) return Effect.void
      const parentSessionId = owner.parent === undefined || owner.parent === sessionID ? undefined : owner.parent
      if (update.type === "shown") {
        send(socket, eventFrame(sessionID, parentSessionId, "suggestion.shown", {
          id: update.suggestion.id,
          sessionID: update.suggestion.sessionID,
          text: update.suggestion.text,
          actions: update.suggestion.actions,
          ...(update.suggestion.tool === undefined ? {} : { tool: update.suggestion.tool }),
        }))
        return Effect.void
      }
      if (update.type === "accepted") {
        send(
          socket,
          eventFrame(sessionID, parentSessionId, "suggestion.accepted", {
            requestID: update.requestID,
            index: update.index,
            action: update.action,
          }),
        )
        return Effect.void
      }
      send(socket, eventFrame(sessionID, parentSessionId, "suggestion.dismissed", { requestID: update.requestID }))
      return Effect.void
    }),
    Effect.catch(() => Effect.void),
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
  client: RemoteSessionClient,
  socket: RelaySocket,
  status: ReturnType<typeof createRemoteStatus>,
  input: Extract<RemoteInbound, { type: "command" }>,
) {
  const parsed = RemoteDropQueuedMessageSchema.safeParse(input.data)
  if (!parsed.success || !input.sessionId) return respond(socket, input.id, "invalid drop_queued_message command")
  const commandSession: string = input.sessionId
  return Effect.gen(function* () {
    // Every advertised id is resolved from public state only — the command
    // session's real pending inbox, then the pending inboxes of its
    // same-location descendants (the root-id contract, since live child queues
    // are advertised under the subscribed root). No adapter-local admission
    // record is consulted, so a fresh adapter, a restarted host, and an item
    // enqueued by another client all cancel the same ids, and a foreign or
    // non-pending id is refused.
    if (!client.session.inbox) return yield* respond(socket, input.id, "message not queued")
    const local = yield* localSession(ctx, client, commandSession)
    if (!local) return yield* respond(socket, input.id, "message not queued")
    const ownerSession = yield* resolveQueueOwner(ctx, client, commandSession, parsed.data.messageID)
    if (ownerSession === undefined) return yield* respond(socket, input.id, "message not queued")
    yield* Effect.tryPromise({
      try: () => client.session.inbox.cancel({ sessionID: ownerSession, inboxID: parsed.data.messageID }),
      catch: () => "failed" as const,
    }).pipe(
      Effect.andThen(respond(socket, input.id)),
      Effect.catch(() => respond(socket, input.id, "message not queued")),
    )
  }).pipe(Effect.catch(() => respond(socket, input.id, "message not queued")))
}

function contains(parent: string, child: string) {
  const path = relative(parent, child)
  return path === "" || (!path.startsWith("..") && !isAbsolute(path))
}

/**
 * Emitted question forms, kept so question.replied can reconstruct v1's
 * positional answers from the form's actual field order. Bounded like the
 * outbound frame buffer.
 */
/** Emitted question forms, keyed by form id; bounded like the outbound buffer. */
const QUESTION_FORM_CACHE_LIMIT = 64

/**
 * Terminal events (permission.replied, form.replied, form.cancelled) bump a
 * per-item epoch so a replay snapshot cannot re-add the resolved ask; the
 * key is the item's identity, so sibling pendings on the same session stay
 * replayable. Bounded like the outbound frame buffer.
 */
const TERMINAL_EPOCH_LIMIT = 256

function bumpTerminal(terminals: Map<string, number>, key: string) {
  terminals.set(key, (terminals.get(key) ?? 0) + 1)
  if (terminals.size > TERMINAL_EPOCH_LIMIT) {
    const oldest = terminals.keys().next().value
    if (oldest !== undefined) terminals.delete(oldest)
  }
}

const TRANSLATION_EVENTS = new Set([
  "permission.asked",
  "permission.replied",
  "form.created",
  "form.replied",
  "form.cancelled",
  "session.inbox.delivered",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.retry.scheduled",
  "session.renamed",
  "session.inbox.enqueued",
  "session.inbox.cancelled",
  "session.step.started",
  "session.step.ended",
  "session.text.delta",
  "session.reasoning.delta",
  "session.text.ended",
  "session.reasoning.ended",
  "session.tool.input.started",
  "session.tool.called",
  "session.tool.success",
  "session.tool.failed",
])

function isTranslationEvent(type: string) {
  return TRANSLATION_EVENTS.has(type)
}

/** Every transcript-translated event carries its sessionID in the payload. */
function frameSessionID(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const payload = data as { sessionID?: unknown }
  return typeof payload.sessionID === "string" ? payload.sessionID : undefined
}

function isSensitivePermission(metadata: PermissionRequest["metadata"]) {
  return metadata?.["skillShell"] === true || metadata?.["sandboxEscalation"] === true
}

function locationInput(ctx: RemoteSessionContext) {
  return {
    directory: ctx.location.directory,
    ...(ctx.location.workspaceID === undefined ? {} : { workspace: ctx.location.workspaceID }),
  }
}

/** The subscribed ancestor of a session, or the session itself when subscribed. */
function subscribedRoot(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "session">,
  subscribed: Set<string>,
  sessionID: string,
) {
  return Effect.promise(async () => {
    const session = await client.session.get({ sessionID }).catch(() => undefined)
    if (!session || !sameLocation(session.location, ctx.location)) return undefined
    if (subscribed.has(sessionID)) return { parent: undefined }
    let parent = session.parentID
    for (let depth = 0; parent !== undefined && depth < 8; depth++) {
      // Fetch and location-validate every ancestor — membership alone is
      // stale once a session moved: the id may still be subscribed while the
      // session now lives in another location.
      const ancestor = await client.session.get({ sessionID: parent }).catch(() => undefined)
      if (!ancestor || !sameLocation(ancestor.location, ctx.location)) return undefined
      if (subscribed.has(ancestor.id)) return { parent: ancestor.id }
      parent = ancestor.parentID
    }
    return undefined
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))
}

function eventFrame(
  sessionId: string,
  parentSessionId: string | undefined,
  event: string,
  data: unknown,
): Extract<RemoteOutbound, { type: "event" }> {
  return { type: "event", sessionId, ...(parentSessionId === undefined ? {} : { parentSessionId }), event, data }
}

/**
 * Legacy wire permission request. Field mapping (v2 → PermissionV1.Request):
 * action→permission, resources→patterns, save→always, tool source id→callID.
 * The v2 `message` field has no v1 request counterpart and is not forwarded.
 */
function permissionV1Data(request: PermissionRequest) {
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(PermissionV1.Request)({
      id: request.id,
      sessionID: request.sessionID,
      permission: request.action,
      patterns: request.resources,
      metadata: request.metadata ?? {},
      always: request.save ?? [],
      ...(request.source?.type === "tool"
        ? { tool: { messageID: request.source.messageID, callID: request.source.id } }
        : {}),
    }),
  )
}

const decodeQuestionInfos = Schema.decodeUnknownOption(Schema.Array(QuestionV1.Info))

/**
 * v1 question request data for a v2 question-producer form. Only forms the
 * question tool creates (metadata kind "question") translate, and only with
 * fields v1 can render: string-with-options or multiselect, without `when`
 * visibility conditions. Anything else returns undefined and is never sent.
 * The frame id is the v2 `frm_` form id: the retained QuestionV1.ID brand
 * (`que_`) cannot accept it, while the deployed consumer validates a plain
 * string (cloud origin/main cloud-agent-sdk questionAskedDataSchema).
 */
function questionV1Data(form: FormInfo) {
  if (form.metadata?.["kind"] !== "question") return undefined
  const questions: Array<Schema.Schema.Type<typeof QuestionV1.Info>> = []
  for (const field of form.fields) {
    if (field.type !== "string" && field.type !== "multiselect") return undefined
    if (field.when !== undefined) return undefined
    const options = field.options?.map((option) => ({ label: option.value, description: option.description ?? "" }))
    if (!options || options.length === 0) return undefined
    const info = Option.getOrUndefined(
      decodeQuestionInfos([
        {
          question: field.description ?? field.title ?? "",
          header: field.title ?? "",
          options,
          ...(field.type === "multiselect" ? { multiple: true } : {}),
          ...(field.custom === undefined ? {} : { custom: field.custom }),
        },
      ]),
    )
    if (info === undefined) return undefined
    questions.push(info[0])
  }
  const tool = form.metadata["tool"]
  const questionTool =
    typeof tool === "object" &&
    tool !== null &&
    "messageID" in tool &&
    "id" in tool &&
    typeof tool.messageID === "string" &&
    typeof tool.id === "string"
      ? { messageID: tool.messageID, callID: tool.id }
      : undefined
  return {
    questions,
    ...(questionTool === undefined ? {} : { tool: questionTool }),
  }
}

/** Positional v1 answers from a keyed v2 form answer, using field order. */
function positionalAnswers(form: Pick<FormInfo, "fields">, answer: Record<string, unknown>): string[][] | undefined {
  return form.fields.map((field) => {
    const value = answer[field.key]
    if (value === undefined) return []
    if (Array.isArray(value)) return value.map((item) => String(item))
    return [String(value)]
  })
}

function rememberQuestionForm(questions: Map<string, FormInfo>, form: FormInfo) {
  questions.set(form.id, form)
  if (questions.size > QUESTION_FORM_CACHE_LIMIT) {
    const oldest = questions.keys().next().value
    if (oldest !== undefined) questions.delete(oldest)
  }
}

function forwardEvent(
  ctx: RemoteSessionContext,
  client: RemoteSessionClient,
  socket: RelaySocket,
  subscribed: Set<string>,
  epochs: Map<string, number>,
  transport: () => number,
  terminals: Map<string, number>,
  questions: Map<string, FormInfo>,
  transcript: ReturnType<typeof createRemoteTranscript>,
  status: ReturnType<typeof createRemoteStatus>,
  event: { readonly type: string; readonly data: unknown; readonly created?: number },
) {
  return Effect.gen(function* () {
    switch (event.type) {
      // Transcript translation: source-proven user/assistant/first-class part
      // frames, ownership-gated like every other lane.
      case "session.inbox.delivered":
      case "session.execution.started":
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted":
      case "session.retry.scheduled":
      case "session.renamed":
      case "session.inbox.enqueued":
      case "session.inbox.cancelled":
      case "session.step.started":
      case "session.step.ended":
      case "session.text.delta":
      case "session.reasoning.delta":
      case "session.text.ended":
      case "session.reasoning.ended":
      case "session.tool.input.started":
      case "session.tool.called":
      case "session.tool.success":
      case "session.tool.failed": {
        // Ownership is validated before any translation I/O: an
        // unsubscribed or foreign session never triggers projection fetches.
        const targetSession = frameSessionID(event.data)
        if (targetSession === undefined) return
        const owner = yield* subscribedRoot(ctx, client, subscribed, targetSession)
        if (!owner) return
        // The subscription that authorized this event: descendant events are
        // forwarded under their subscribed root, so that root's membership is
        // what keeps an in-flight queue read alive.
        const subscriptionRoot = owner.parent ?? targetSession
        const emitStatus = (statusFrame: StatusFrame) =>
          send(
            socket,
            eventFrame(
              statusFrame.sessionId,
              owner.parent === statusFrame.sessionId ? undefined : owner.parent,
              statusFrame.event,
              statusFrame.data,
            ),
          )
        for (const statusFrame of statusFrames({ type: event.type, data: event.data })) emitStatus(statusFrame)
        // The queue lane re-reads the authoritative pending inbox instead of
        // mutating a local list, so an evicted, restarted, or never-seen
        // session advertises the same ids as a long-lived one.
        if (invalidatesQueue({ type: event.type, data: event.data })) {
          // The same guard the replay lane captures: an unsubscribe, a
          // resubscribe, or a reconnect while the read is in flight discards it
          // instead of publishing a snapshot for a subscription that is gone.
          const epoch = epochs.get(subscriptionRoot)
          const capturedTransport = transport()
          const queued = yield* Effect.promise(() =>
            queueFrames(
              status,
              client,
              targetSession,
              () =>
                epochs.get(subscriptionRoot) === epoch &&
                subscribed.has(subscriptionRoot) &&
                transport() === capturedTransport,
            ),
          ).pipe(Effect.catchCause(() => Effect.succeed([] as StatusFrame[])))
          for (const statusFrame of queued) emitStatus(statusFrame)
        }
        // catchCause: a defect inside the translation (or its projection
        // fetches) must not kill this fiber — the relay keeps running and
        // later events recover.
        const frames = yield* transcriptFrames(transcript, ctx.location.directory, client, {
          type: event.type,
          created: "created" in event && typeof event.created === "number" ? event.created : undefined,
          data: event.data,
        }).pipe(Effect.catchCause(() => Effect.succeed([] as TranscriptFrame[])))
        if (frames.length === 0) return
        for (const translated of frames) {
          send(
            socket,
            eventFrame(
              translated.sessionId,
              owner.parent === translated.sessionId ? undefined : owner.parent,
              translated.event,
              translated.data,
            ),
          )
        }
        return
      }
      // Each domain forwards only when its namespace exists: a form-only host
      // never emits permission frames and a permission-only host never emits
      // question frames — absent namespaces neither forward nor answer.
      case "permission.asked": {
        if (!client.permission) return
        const payload = event.data as PermissionRequest
        const owner = yield* subscribedRoot(ctx, client, subscribed, payload.sessionID)
        if (!owner) return
        const data = permissionV1Data(payload)
        if (!data) return
        send(socket, eventFrame(payload.sessionID, owner.parent, "permission.asked", data))
        return
      }
      case "permission.replied": {
        const payload = event.data as { sessionID: string; requestID: string; reply: string }
        // A terminal invalidates any in-flight replay snapshot for this
        // session: a replayed asked must never follow the processed terminal.
        bumpTerminal(terminals, `permission:${payload.requestID}`)
        if (!client.permission) return
        const owner = yield* subscribedRoot(ctx, client, subscribed, payload.sessionID)
        if (!owner) return
        send(
          socket,
          eventFrame(payload.sessionID, owner.parent, "permission.replied", {
            sessionID: payload.sessionID,
            requestID: payload.requestID,
            reply: payload.reply,
          }),
        )
        return
      }
      case "form.created": {
        if (!client.form) return
        const payload = event.data as { form: FormInfo }
        const data = questionV1Data(payload.form)
        if (!data) return
        const owner = yield* subscribedRoot(ctx, client, subscribed, payload.form.sessionID)
        if (!owner) return
        rememberQuestionForm(questions, payload.form)
        send(
          socket,
          eventFrame(payload.form.sessionID, owner.parent, "question.asked", {
            id: payload.form.id,
            sessionID: payload.form.sessionID,
            ...data,
          }),
        )
        return
      }
      case "form.replied": {
        const payload = event.data as { id: string; sessionID: string; answer: Record<string, unknown> }
        bumpTerminal(terminals, `form:${payload.id}`)
        if (!client.form) return
        const owner = yield* subscribedRoot(ctx, client, subscribed, payload.sessionID)
        if (!owner) return
        const cached = questions.get(payload.id)
        const form =
          cached ??
          (client.form
            ? (yield* resolveForm(ctx, client, client.form, payload.sessionID, payload.id))?.form
            : undefined)
        questions.delete(payload.id)
        // Terminal frames only for supported question-producer forms, and
        // only with reconstructable positional answers: v1's replied event
        // requires them, so the event is omitted rather than sent as a
        // partial shape. Nonquestion controls (websearch, skill-shell) are
        // never forwarded.
        if (!form || questionV1Data(form) === undefined) return
        send(
          socket,
          eventFrame(payload.sessionID, owner.parent, "question.replied", {
            sessionID: payload.sessionID,
            requestID: payload.id,
            answers: positionalAnswers(form, payload.answer),
          }),
        )
        return
      }
      case "form.cancelled": {
        const payload = event.data as { id: string; sessionID: string }
        bumpTerminal(terminals, `form:${payload.id}`)
        if (!client.form) return
        const owner = yield* subscribedRoot(ctx, client, subscribed, payload.sessionID)
        if (!owner) return
        const cached = questions.get(payload.id)
        const form =
          cached ??
          (client.form
            ? (yield* resolveForm(ctx, client, client.form, payload.sessionID, payload.id))?.form
            : undefined)
        questions.delete(payload.id)
        if (!form || questionV1Data(form) === undefined) return
        send(
          socket,
          eventFrame(payload.sessionID, owner.parent, "question.rejected", {
            sessionID: payload.sessionID,
            requestID: payload.id,
          }),
        )
        return
      }
      default:
        return
    }
  }).pipe(Effect.catch(() => Effect.void))
}

function replayPending(
  ctx: RemoteSessionContext,
  client: RemoteSessionClient,
  socket: RelaySocket,
  subscribed: Set<string>,
  questions: Map<string, FormInfo>,
  terminals: Map<string, number>,
  sessionID: string,
  isActive: () => boolean,
  transport: () => number,
) {
  const permissions = client.permission
  const forms = client.form
  // Either namespace alone replays its own domain; both absent is the only
  // no-replay case.
  if (!permissions && !forms) return Effect.void
  return Effect.gen(function* () {
    // Capture the transport generation: frames emitted after a disconnect
    // would buffer and duplicate the fresh replay the reconnect schedules.
    const atTransport = transport()
    // Terminal events observed after this snapshot invalidate the replayed
    // ask for that resolved item only: a replayed permission.asked arriving
    // after the consumer processed the terminal would re-add a stale
    // interaction (cloud origin/main cloud-agent-sdk service-state.ts
    // process*Asked), while sibling pendings stay replayable.
    const baselines = new Map(terminals)
    const location = locationInput(ctx)
    // Domains fetch independently, and an absent namespace contributes an
    // empty domain instead of disabling replay: a failing permission or form
    // list must not suppress the other domain's pending replay either.
    const listed = yield* Effect.promise(() =>
      Promise.all([
        permissions
          ? permissions.request
              .list({ location })
              .then((value) => value.data)
              .catch(() => [])
          : Promise.resolve([]),
        forms
          ? forms.request
              .list({ location })
              .then((value) => value.data)
              .catch(() => [])
          : Promise.resolve([]),
      ]),
    ).pipe(Effect.catch(() => Effect.succeed(undefined)))
    // Replay is bound to the subscription it belongs to: an immediate
    // unsubscribe supersedes it before any frame is sent.
    if (!listed || !isActive() || transport() !== atTransport) return
    const [requests, pending] = listed
    for (const request of requests) {
      const owner = yield* subscribedRoot(ctx, client, subscribed, request.sessionID)
      // The pending item replays only under the subscription that owns its
      // validated ancestry — the session itself, or the subscribed root this
      // replay belongs to. Ancestry is validated per item, including the
      // root's current location, so a moved root or intermediate drops the
      // subtree without trusting a whole-listing snapshot.
      const self = request.sessionID === sessionID
      if (!owner || (!self && owner.parent !== sessionID)) continue
      if (!isActive() || transport() !== atTransport) return
      if (terminals.get(`permission:${request.id}`) !== baselines.get(`permission:${request.id}`)) continue
      const data = permissionV1Data(request)
      if (data) {
        send(socket, eventFrame(request.sessionID, self ? undefined : sessionID, "permission.asked", data))
      }
    }
    for (const form of pending) {
      const owner = yield* subscribedRoot(ctx, client, subscribed, form.sessionID)
      const self = form.sessionID === sessionID
      if (!owner || (!self && owner.parent !== sessionID)) continue
      if (!isActive() || transport() !== atTransport) return
      if (terminals.get(`form:${form.id}`) !== baselines.get(`form:${form.id}`)) continue
      const data = questionV1Data(form)
      if (!data) continue
      rememberQuestionForm(questions, form)
      send(
        socket,
        eventFrame(form.sessionID, self ? undefined : sessionID, "question.asked", {
          id: form.id,
          sessionID: form.sessionID,
          ...data,
        }),
      )
    }
  }).pipe(Effect.catch(() => Effect.void))
}

/**
 * Same-location descendant proof: every node from the descendant up to and
 * including the claimed ancestor is fetched and location-validated within the
 * existing 8-hop bound. A moved intermediate or root breaks the chain.
 */
function hasValidatedAncestor(
  ctx: RemoteSessionContext,
  client: Pick<OpenCodeClient, "session">,
  descendantID: string,
  ancestorID: string,
) {
  return Effect.promise(async () => {
    // Distance 0: the descendant itself.
    const self = await client.session.get({ sessionID: descendantID }).catch(() => undefined)
    if (!self || !sameLocation(self.location, ctx.location)) return false
    if (descendantID === ancestorID) return true
    let current: string | undefined = self.parentID
    // Eight parent edges: the same distance bound subscribedRoot accepts.
    for (let edges = 0; current !== undefined && edges < 8; edges++) {
      const session = await client.session.get({ sessionID: current }).catch(() => undefined)
      if (!session || !sameLocation(session.location, ctx.location)) return false
      if (current === ancestorID) return true
      const parent: string | undefined = session.parentID
      if (parent === undefined) return false
      current = parent
    }
    return false
  }).pipe(Effect.catch(() => Effect.succeed(false)))
}

function resolvePermission(
  ctx: RemoteSessionContext,
  client: RemoteSessionClient,
  commandSession: string | undefined,
  requestID: string,
) {
  const api = client.permission
  if (!api) return Effect.succeed<PermissionRequest | undefined>(undefined)
  return Effect.gen(function* () {
    // Direct path: the command's own session owns the request.
    if (commandSession !== undefined) {
      const direct = yield* Effect.tryPromise({
        try: () => api.get({ sessionID: commandSession, requestID }),
        catch: () => "unavailable" as const,
      }).pipe(Effect.catch(() => Effect.succeed<PermissionRequest | undefined>(undefined)))
      if (direct) {
        // The request must belong to a session this adapter owns, so a
        // request id from another location can never be answered here.
        const owned = yield* localSession(ctx, client, direct.sessionID)
        return owned ? direct : undefined
      }
    }
    // The deployed consumer accepts a child ask via parentSessionId but sends
    // its commands with the subscription root as sessionId
    // (cloud origin/main cloud-agent-sdk cli-live-transport.ts sendCommand):
    // fall back to the location-scoped pending list and prove the actual
    // owner is a same-location descendant of the command root. Arbitrary
    // same-location ids are never redirected.
    const request = yield* Effect.tryPromise({
      try: async () =>
        (await api.request.list({ location: locationInput(ctx) })).data.find((item) => item.id === requestID),
      catch: () => "unavailable" as const,
    }).pipe(Effect.catch(() => Effect.succeed<PermissionRequest | undefined>(undefined)))
    if (request === undefined) return undefined
    const owner = yield* localSession(ctx, client, request.sessionID)
    if (!owner) return undefined
    if (commandSession !== undefined && request.sessionID !== commandSession) {
      const descendant = yield* hasValidatedAncestor(ctx, client, request.sessionID, commandSession)
      if (!descendant) return undefined
    }
    return request
  }).pipe(Effect.catch(() => Effect.succeed<PermissionRequest | undefined>(undefined)))
}

function permissionRespond(
  ctx: RemoteSessionContext,
  client: RemoteSessionClient,
  socket: RelaySocket,
  input: Extract<RemoteInbound, { type: "command" }>,
) {
  const parsed = RemotePermissionRespondSchema.safeParse(input.data)
  if (!parsed.success) return respond(socket, input.id, "invalid permission_respond data")
  const api = client.permission
  if (!api) return respond(socket, input.id, "permission handling is unavailable")
  return Effect.flatMap(resolvePermission(ctx, client, input.sessionId, parsed.data.requestID), (request) => {
    // Resolution proves ownership: the command's own session, or a
    // same-location descendant of it when the consumer addresses the root.
    if (!request) {
      return respond(socket, input.id, "permission request not found")
    }
    // v1 wire compat (ecccd1f permission/index.ts): sensitive approvals from
    // the relay require the explicit human `interactive` bit. No current v2
    // producer marks skillShell/sandboxEscalation metadata; the gate keeps
    // that v1 contract for any request that carries the markers.
    if (parsed.data.reply !== "reject" && isSensitivePermission(request.metadata) && parsed.data.interactive !== true) {
      return respond(socket, input.id, "sensitive permission approval requires an interactive human reply")
    }
    return Effect.tryPromise({
      try: () =>
        api.reply({
          sessionID: request.sessionID,
          requestID: request.id,
          reply: parsed.data.reply,
          ...(parsed.data.message === undefined ? {} : { message: parsed.data.message }),
        }),
      catch: () => "failed" as const,
    }).pipe(
      Effect.andThen(respond(socket, input.id)),
      Effect.catch(() => respond(socket, input.id, "permission reply failed")),
    )
  })
}

function resolveForm(
  ctx: RemoteSessionContext,
  client: RemoteSessionClient,
  forms: NonNullable<RemoteSessionClient["form"]>,
  commandSession: string | undefined,
  formID: string,
) {
  return Effect.gen(function* () {
    // Direct path: the command's own session owns the form.
    if (commandSession !== undefined) {
      const direct = yield* Effect.tryPromise({
        try: () => forms.get({ sessionID: commandSession, formID }),
        catch: () => "unavailable" as const,
      }).pipe(Effect.catch(() => Effect.succeed<FormInfo | undefined>(undefined)))
      if (direct) {
        // The form must belong to a session this adapter owns, so a form id
        // from another location can never be answered here.
        const owned = yield* localSession(ctx, client, direct.sessionID)
        if (owned) return { form: direct }
        return undefined
      }
    }
    // The deployed consumer sends question commands with the subscription
    // root as sessionId even for child asks: fall back to the location-scoped
    // pending list and prove the actual owner is a same-location descendant
    // of the command root. Arbitrary same-location ids are never redirected.
    const form = yield* Effect.tryPromise({
      try: async () =>
        (await forms.request.list({ location: locationInput(ctx) })).data.find((item) => item.id === formID),
      catch: () => "unavailable" as const,
    }).pipe(Effect.catch(() => Effect.succeed<FormInfo | undefined>(undefined)))
    if (form === undefined) return undefined
    const owner = yield* localSession(ctx, client, form.sessionID)
    if (!owner) return undefined
    if (commandSession !== undefined && form.sessionID !== commandSession) {
      const descendant = yield* hasValidatedAncestor(ctx, client, form.sessionID, commandSession)
      if (!descendant) return undefined
    }
    return { form }
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))
}

function questionReply(
  ctx: RemoteSessionContext,
  client: RemoteSessionClient,
  socket: RelaySocket,
  input: Extract<RemoteInbound, { type: "command" }>,
) {
  const parsed = RemoteQuestionReplySchema.safeParse(input.data)
  if (!parsed.success) return respond(socket, input.id, "invalid question_reply data")
  const forms = client.form
  if (!forms) return respond(socket, input.id, "question handling is unavailable")
  return Effect.flatMap(resolveForm(ctx, client, forms, input.sessionId, parsed.data.requestID), (resolved) => {
    // Resolution proves ownership (own session or validated descendant of the
    // command root).
    if (!resolved) {
      return respond(socket, input.id, "question request not found")
    }
    if (questionV1Data(resolved.form) === undefined) {
      return respond(socket, input.id, "unsupported question form")
    }
    if (parsed.data.answers.length !== resolved.form.fields.length) {
      return respond(socket, input.id, "invalid question_reply answers")
    }
    const answer: Record<string, string | string[]> = {}
    for (const [index, field] of resolved.form.fields.entries()) {
      const value = parsed.data.answers[index] ?? []
      if (field.type === "multiselect") {
        answer[field.key] = value
        continue
      }
      if (value.length === 0) continue
      // v1 answers are labels; a single-select v2 field accepts at most one
      // label. Extra labels cannot map losslessly and are refused, never
      // truncated.
      if (value.length > 1) {
        return respond(socket, input.id, "question_reply cannot map multiple selections onto a single-select question")
      }
      answer[field.key] = value[0]
    }
    return Effect.tryPromise({
      try: () => forms.reply({ sessionID: resolved.form.sessionID, formID: resolved.form.id, answer }),
      catch: () => "failed" as const,
    }).pipe(
      Effect.andThen(respond(socket, input.id)),
      Effect.catch(() => respond(socket, input.id, "question reply failed")),
    )
  })
}

function questionReject(
  ctx: RemoteSessionContext,
  client: RemoteSessionClient,
  socket: RelaySocket,
  input: Extract<RemoteInbound, { type: "command" }>,
) {
  const parsed = RemoteQuestionRejectSchema.safeParse(input.data)
  if (!parsed.success) return respond(socket, input.id, "invalid question_reject data")
  const forms = client.form
  if (!forms) return respond(socket, input.id, "question handling is unavailable")
  return Effect.flatMap(resolveForm(ctx, client, forms, input.sessionId, parsed.data.requestID), (resolved) => {
    // Resolution proves ownership (own session or validated descendant).
    if (!resolved) {
      return respond(socket, input.id, "question request not found")
    }
    // Rejection is a question-command concern: a resolved nonquestion control
    // form (websearch, skill-shell) is refused here, never cancelled through
    // the question path.
    if (questionV1Data(resolved.form) === undefined) {
      return respond(socket, input.id, "unsupported question form")
    }
    return Effect.tryPromise({
      try: () => forms.cancel({ sessionID: resolved.form.sessionID, formID: resolved.form.id }),
      catch: () => "failed" as const,
    }).pipe(
      Effect.andThen(respond(socket, input.id)),
      Effect.catch(() => respond(socket, input.id, "question reply failed")),
    )
  })
}
