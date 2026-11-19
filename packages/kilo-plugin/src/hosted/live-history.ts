import { Schema } from "effect"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { HostedError } from "./error.js"
import { cursor, invalidResponse, json } from "./live-io.js"
import { conversationRow } from "./live-conversation.js"
import { PAGE_SIZE, parsePage } from "./live-state.js"

export type Request = (
  target: KiloHostedRpc.Target,
  path: string,
  init: RequestInit & { signal: AbortSignal },
) => Promise<Response>
const record = Schema.Record(Schema.String, Schema.Unknown)
const page = Schema.decodeUnknownSync(
  Schema.Struct({
    result: Schema.Struct({
      data: Schema.NullOr(
        Schema.Struct({
          kind: Schema.Literal("success"),
          info: Schema.Struct({ id: Schema.String }),
          source: Schema.optional(record),
          messages: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(PAGE_SIZE)),
          preparationAttempts: Schema.optional(Schema.Array(Schema.Unknown)),
          nextCursor: Schema.NullOr(Schema.String),
        }),
      ),
    }),
  }),
)
const item = Schema.decodeUnknownSync(Schema.Struct({ message: record }))
type Token = { source: "stored" | "ingest"; value: string; sessionID: string }

export class History {
  private readonly cursors = new Map<string, Token>()
  constructor(
    private readonly target: KiloHostedRpc.Target,
    private readonly request: Request,
    private readonly controlID: string | void,
  ) {}

  async read(abort: AbortSignal, before?: string, childID?: string) {
    const signal = AbortSignal.any([abort, AbortSignal.timeout(30_000)])
    const token = before ? this.cursors.get(before) : undefined
    const sessionID = childID ?? this.target.sessionID
    if (before && token?.sessionID !== sessionID)
      throw new HostedError("Cloud session history cursor expired. Reopen the session.")
    if (this.controlID?.startsWith("workspace_") && token?.source !== "ingest") {
      const query = new URLSearchParams({
        input: JSON.stringify({
          sessionId: this.controlID,
          kiloSessionId: sessionID,
          limit: PAGE_SIZE,
          cursor: token?.value,
        }),
      })
      const response = await this.request(this.target, `/trpc/getSessionMessagesPage?${query}`, {
        method: "GET",
        signal,
      })
      const saved = page(await json(response, signal, 4 * 1024 * 1024)).result.data
      if (saved)
        return {
          rows: storedRows(sessionID, saved),
          before: this.cursor("stored", saved.nextCursor, sessionID),
          attempts: saved.preparationAttempts,
        }
      if (token) throw invalidResponse()
      // A prepared workspace need not have a registered runtime DO yet. Its independently authorized ingest history may exist.
    }
    // A child must be served by the worker under the authorized root's control ID. Never fall back to an independent child route.
    if (childID) throw new HostedError("Cloud has no captured history for this subagent.")
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) })
    if (token) query.set("before", token.value)
    const response = await this.request(this.target, `/kilo/session/${sessionID}/message?${query}`, {
      method: "GET",
      signal,
    })
    if (!before && response.status === 503) {
      const error = await json(new Response(response.body), signal, 4096)
      if (Schema.is(Schema.Struct({ error: Schema.Literal("KILO_SESSION_SNAPSHOT_PENDING") }))(error))
        return { rows: [], before: undefined, pending: true as const }
      throw new HostedError("Cloud session history is temporarily unavailable.")
    }
    return {
      rows: parsePage(await json(response, signal, 4 * 1024 * 1024), sessionID),
      before: this.cursor("ingest", response.headers.get("x-next-cursor"), sessionID),
    }
  }

  // The stored cursor includes internal routing IDs. Only hand a scoped, opaque handle to the client.
  private cursor(source: Token["source"], raw: string | null, sessionID: string) {
    if (!raw) return
    const value = cursor(raw)
    for (const [id, token] of this.cursors)
      if (token.source === source && token.value === value && token.sessionID === sessionID) return id
    if (this.cursors.size >= 256) this.cursors.delete(this.cursors.keys().next().value!)
    const id = crypto.randomUUID()
    this.cursors.set(id, { source, value, sessionID })
    return id
  }
}

function storedRows(sessionID: string, saved: NonNullable<ReturnType<typeof page>["result"]["data"]>) {
  if (saved.info.id !== sessionID) throw invalidResponse()
  const source = saved.source
  if (source?.version === "v2") {
    if (!Schema.is(Schema.Struct({ id: Schema.Literal(sessionID) }))(source.session)) throw invalidResponse()
    return saved.messages.flatMap((raw) => conversationRow(sessionID, { source, message: item(raw).message }) ?? [])
  }
  if (source && source.version !== "v1") throw invalidResponse()
  return parsePage(saved.messages, sessionID)
}
