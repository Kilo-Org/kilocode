// A v1 `KiloClient` facade over the Kilo v2 server. The extension keeps the v1 SDK shapes as its view model;
// this module maps the chat path onto the v2 client (`@opencode/client`). A call outside the mapped path fails with
// an error and is logged once, so callers see the gap instead of fake data.
import type { GlobalEvent, KiloClient, Session } from "@kilocode/sdk-v1/v2/client"
import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { KiloHandshakeRpc } from "@opencode/schema/kilocode/handshake"
import { V2Events } from "./events"
import {
  agentView,
  configView,
  messagesView,
  permissionView,
  providersView,
  questionView,
  sessionView,
} from "./projection"

type Options = { throwOnError?: boolean; signal?: AbortSignal }
type Scope = { directory?: string }
type Prompt = Scope & {
  sessionID: string
  messageID?: string
  parts?: Array<{ type: string; text?: string; url?: string; filename?: string; mime?: string; metadata?: unknown }>
  model?: { providerID: string; modelID: string }
  agent?: string
  variant?: string
}

export type V2Options = {
  baseUrl: string
  headers: Record<string, string>
  fetch?: typeof globalThis.fetch
  /** Directory used when a v1 call does not name one. */
  directory: () => string | undefined
}

/** SDK methods that callers reached but the v2 adapter does not map. Each one is logged once. */
const unmapped = new Set<string>()
const HEARTBEAT_MS = 5_000

/**
 * The extension synthesizes a v1 cursor (`{ id, time }`) from the oldest loaded message. Translate it into the
 * v2 message cursor, which pages from that message toward older ones.
 */
export function cursor(value: string): string {
  const parsed = decode(value)
  if (!parsed || typeof parsed.id !== "string" || "order" in parsed) return value
  return Buffer.from(JSON.stringify({ id: parsed.id, order: "desc", direction: "next" }), "utf8").toString("base64url")
}

/** Wraps work in the v1 SDK result envelope and honors `throwOnError`. */
function result<T>(work: () => Promise<T>, opts?: Options, headers?: () => Record<string, string>) {
  return work().then(
    (data) => ({ data, error: undefined, response: new Response(null, { headers: headers?.() }) }),
    (error: unknown) => {
      if (opts?.throwOnError) throw error
      return { data: undefined, error, response: undefined }
    },
  )
}

/** Returns mapped methods where present and an error for every other SDK path. */
function facade(path: string[], impl: unknown): unknown {
  return new Proxy(function () {}, {
    get(_target, key) {
      if (typeof key === "symbol" || key === "then") return undefined
      const next = impl && typeof impl === "object" ? (impl as Record<string, unknown>)[key] : undefined
      if (typeof next === "function") return next
      return facade([...path, key], next)
    },
    apply(_target, _self, args: unknown[]) {
      const name = path.join(".")
      if (!unmapped.has(name)) console.warn(`[Kilo New] v2: unmapped SDK method ${name}`)
      unmapped.add(name)
      const error = new Error(`${name} is not available with the Kilo v2 server`)
      const opts = args[1] as Options | undefined
      if (opts?.throwOnError) return Promise.reject(error)
      return Promise.resolve({ data: undefined, error, response: undefined })
    },
  })
}

export function createV2Client(opts: V2Options): KiloClient {
  const raw = OpenCode.make({ baseUrl: opts.baseUrl, headers: opts.headers, fetch: opts.fetch })
  const gateway = raw.rpc(KiloGatewayRpc.Definition)
  const dir = (scope?: Scope) => scope?.directory ?? opts.directory() ?? ""
  const location = (scope?: Scope) => ({ directory: dir(scope) })

  // Permission and question replies in v1 name only the request; v2 routes them under the session.
  const owners = new Map<string, string>()
  const fold = new V2Events({
    directory: () => opts.directory() ?? "",
    session: async (id) => sessionView(await raw.session.get({ sessionID: id })),
  })
  const owner = async (id: string, scope?: Scope) => {
    const known = owners.get(id)
    if (known) return known
    const [permissions, forms] = await Promise.all([
      raw.permission.request.list({ location: location(scope) }),
      raw.form.list({ location: location(scope) }),
    ])
    const found = [...permissions.data, ...forms.data].find((item) => item.id === id)
    if (!found) throw new Error(`Request ${id} is not pending`)
    return found.sessionID
  }

  const rules = new Map<string, string[]>()
  const always = async (input: { sessionID: string; requestID: string }, approved: string[], o?: Options) => {
    const request = await raw.permission.get(input, o)
    const save = request.save ?? []
    if (save.every((pattern) => approved.includes(pattern))) return "always" as const
    throw new Error("Saving only some patterns is not available with the Kilo v2 server")
  }

  // v1 sends agent and model with every prompt; v2 keeps them as session state.
  const select = async (input: Prompt, o?: Options) => {
    if (input.agent) await raw.session.switchAgent({ sessionID: input.sessionID, agent: input.agent }, o)
    if (input.model)
      await raw.session.switchModel(
        {
          sessionID: input.sessionID,
          model: { id: input.model.modelID, providerID: input.model.providerID, variant: input.variant || undefined },
        },
        o,
      )
  }
  const text = (input: Prompt) =>
    (input.parts ?? []).flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n\n")
  const files = (input: Prompt) =>
    (input.parts ?? []).flatMap((part) =>
      part.type === "file" && part.url ? [{ uri: part.url, name: part.filename }] : [],
    )
  const metadata = (input: Prompt) => {
    const part = (input.parts ?? []).find((item) => item.type === "text" && item.metadata)
    return part?.metadata as Record<string, never> | undefined
  }

  const sessions = async (scope: Scope & { roots?: boolean; limit?: number; search?: string }, o?: Options) => {
    const page = await raw.session.list(
      { directory: dir(scope), limit: scope.limit, search: scope.search, order: "desc" },
      { signal: o?.signal },
    )
    return page.data.filter((item) => !scope.roots || !item.parentID).map(sessionView)
  }

  const impl = {
    app: {
      agents: (scope?: Scope, o?: Options) =>
        result(async () => (await raw.agent.list({ location: location(scope) }, o)).data.map(agentView), o),
      skills: (scope?: Scope, o?: Options) =>
        result(
          async () =>
            (await raw.skill.list({ location: location(scope) }, o)).data.map((skill) => ({
              name: skill.name,
              description: skill.description ?? "",
              location: skill.path,
              content: skill.content,
            })),
          o,
        ),
    },
    command: {
      list: (scope?: Scope, o?: Options) =>
        result(
          async () =>
            (await raw.command.list({ location: location(scope) }, o)).data.map((command) => ({
              name: command.name,
              description: command.description,
              template: "",
              hints: [],
            })),
          o,
        ),
    },
    provider: {
      list: (scope?: Scope, o?: Options) =>
        result(async () => {
          const where = { location: location(scope) }
          const [providers, models, fallback] = await Promise.all([
            raw.provider.list(where, o),
            raw.model.list(where, o),
            raw.model.default(where, o),
          ])
          return providersView({ providers: providers.data, models: models.data, fallback: fallback.data })
        }, o),
    },
    config: {
      get: (scope?: Scope, o?: Options) =>
        result(async () => configView(await raw.config.get({ location: location(scope) }, o)), o),
    },
    global: {
      config: {
        get: (_scope?: Scope, o?: Options) => result(async () => configView(await raw.config.get({}, o)), o),
      },
      event: async (o?: { signal?: AbortSignal }) => ({
        stream: stream(raw, fold, o?.signal, (event) => {
          if (event.payload.type === "permission.asked" || event.payload.type === "question.asked")
            owners.set(event.payload.properties.id, event.payload.properties.sessionID)
        }),
      }),
    },
    kilo: {
      authStatus: (scope?: Scope, o?: Options) =>
        result(async () => {
          const status = await gateway.authStatus({}, { location: location(scope), signal: o?.signal })
          return { authenticated: status.authenticated, organizationId: status.organizationID ?? undefined }
        }, o),
      notifications: (_input?: unknown, o?: Options) =>
        result(async () => {
          const status = await gateway.authStatus({}, { signal: o?.signal })
          // Signed-out users have no notifications; the RPC reports that as an `unauthorized` error.
          if (!status.authenticated) return []
          return [...(await gateway.notifications({}, { signal: o?.signal }))]
        }, o),
      profile: (_input?: unknown, o?: Options) =>
        result(async () => {
          const [profile, balance] = await Promise.all([
            gateway.profile({}, { signal: o?.signal }),
            gateway.balance({}, { signal: o?.signal }),
          ])
          return {
            profile: {
              email: profile.email,
              name: profile.name,
              organizations: profile.organizations,
              selectedOrganizationId: profile.organizationID ?? undefined,
              hasPersonalAccount: profile.hasPersonalAccount,
            },
            balance: balance.balance === null ? null : { balance: balance.balance },
            kiloPass: null,
            currentOrgId: profile.organizationID ?? null,
          }
        }, o),
    },
    project: {
      current: (scope?: Scope, o?: Options) =>
        result(async () => {
          const info = await raw.location.get({ location: location(scope) }, o)
          const project = (await raw.project.list({}, o)).find((item) => item.id === info.project.id)
          return {
            id: info.project.id,
            worktree: info.project.directory,
            vcs: project?.vcs,
            name: project?.name,
            time: project?.time ?? { created: 0, updated: 0 },
            sandboxes: project?.sandboxes ?? [],
          }
        }, o),
    },
    mcp: {
      status: (scope?: Scope, o?: Options) =>
        result(async () => {
          const list = await raw.mcp.list({ location: location(scope) }, o)
          return Object.fromEntries(list.data.map((server) => [server.name, server.status]))
        }, o),
    },
    permission: {
      list: (scope?: Scope, o?: Options) =>
        result(async () => {
          const list = await raw.permission.request.list({ location: location(scope) }, o)
          for (const item of list.data) owners.set(item.id, item.sessionID)
          return list.data.map(permissionView)
        }, o),
      // v1 saves "always" rules per pattern before the reply. v2 has one decision: "always" saves the request's own
      // `save` patterns. The rule save is kept until the reply, which sends "always" when it covers every pattern.
      saveAlwaysRules: (
        input: Scope & { requestID: string; approvedAlways?: string[]; deniedAlways?: string[] },
        o?: Options,
      ) =>
        result(async () => {
          if (input.deniedAlways?.length)
            throw new Error("Always denying a pattern is not available with the Kilo v2 server")
          rules.set(input.requestID, input.approvedAlways ?? [])
          return true
        }, o),
      reply: (
        input: Scope & { requestID: string; reply: "once" | "always" | "reject"; message?: string },
        o?: Options,
      ) =>
        result(async () => {
          const sessionID = await owner(input.requestID, input)
          const approved = rules.get(input.requestID) ?? []
          rules.delete(input.requestID)
          const decision =
            input.reply === "once" && approved.length
              ? await always({ sessionID, requestID: input.requestID }, approved, o)
              : input.reply
          await raw.permission.reply({ sessionID, requestID: input.requestID, decision, message: input.message }, o)
          owners.delete(input.requestID)
          return true
        }, o),
    },
    question: {
      list: (scope?: Scope, o?: Options) =>
        result(async () => {
          const list = await raw.form.list({ location: location(scope) }, o)
          for (const item of list.data) owners.set(item.id, item.sessionID)
          return list.data.map(questionView)
        }, o),
      reply: (input: Scope & { requestID: string; answers: string[][] }, o?: Options) =>
        result(async () => {
          const sessionID = await owner(input.requestID, input)
          const form = await raw.session.form.get({ sessionID, formID: input.requestID }, o)
          const answer = Object.fromEntries(
            form.fields.map((field, index) => {
              const value = input.answers[index] ?? []
              return [field.key, field.type === "multiselect" ? value : value.join(", ")]
            }),
          )
          await raw.session.form.reply({ sessionID, formID: input.requestID, answer }, o)
          owners.delete(input.requestID)
          return true
        }, o),
      reject: (input: Scope & { requestID: string }, o?: Options) =>
        result(async () => {
          const sessionID = await owner(input.requestID, input)
          await raw.session.form.cancel({ sessionID, formID: input.requestID }, o)
          owners.delete(input.requestID)
          return true
        }, o),
    },
    find: {
      files: (input: Scope & { query: string; type?: "file" | "directory"; limit?: number }, o?: Options) =>
        result(
          async () =>
            (
              await raw.file.find(
                { location: location(input), query: input.query, type: input.type, limit: input.limit },
                o,
              )
            ).data.map((entry) => entry.path),
          o,
        ),
    },
    experimental: {
      session: {
        list: (scope: Scope & { roots?: boolean; limit?: number; search?: string }, o?: Options) =>
          result(() => sessions(scope, o), o),
      },
    },
    session: {
      list: (scope: Scope & { roots?: boolean; limit?: number; search?: string }, o?: Options) =>
        result(() => sessions(scope, o), o),
      status: (_scope?: Scope, o?: Options) =>
        result(async () => {
          const active = await raw.session.active(o)
          return Object.fromEntries(Object.keys(active).map((id) => [id, { type: "busy" as const }]))
        }, o),
      get: (input: Scope & { sessionID: string }, o?: Options) =>
        result(async (): Promise<Session> => sessionView(await raw.session.get({ sessionID: input.sessionID }, o)), o),
      create: (input: Scope & { title?: string; parentID?: string; agent?: string; metadata?: object }, o?: Options) =>
        result(
          async () =>
            sessionView(
              await raw.session.create(
                {
                  location: location(input),
                  title: input.title,
                  parentID: input.parentID,
                  agent: input.agent,
                  metadata: input.metadata as Record<string, never> | undefined,
                },
                o,
              ),
            ),
          o,
        ),
      update: (input: Scope & { sessionID: string; title?: string; metadata?: object }, o?: Options) =>
        result(async () => {
          await raw.session.update(
            {
              sessionID: input.sessionID,
              title: input.title,
              metadata: input.metadata as Record<string, never> | undefined,
            },
            o,
          )
          return sessionView(await raw.session.get({ sessionID: input.sessionID }, o))
        }, o),
      delete: (input: Scope & { sessionID: string }, o?: Options) =>
        result(async () => {
          await raw.session.remove({ sessionID: input.sessionID }, o)
          return true
        }, o),
      fork: (input: Scope & { sessionID: string; messageID?: string }, o?: Options) =>
        result(
          async () => sessionView(await raw.session.fork({ sessionID: input.sessionID, before: input.messageID }, o)),
          o,
        ),
      diff: (input: Scope & { sessionID: string }, o?: Options) =>
        result(async () => (await raw.session.diff({ sessionID: input.sessionID }, o)).map((diff) => ({ ...diff })), o),
      promptAsync: (input: Prompt, o?: Options) =>
        result(async () => {
          await select(input, o)
          await raw.session.prompt(
            {
              sessionID: input.sessionID,
              id: input.messageID,
              text: text(input),
              files: files(input),
              metadata: metadata(input),
            },
            o,
          )
        }, o),
      command: (input: Omit<Prompt, "model"> & { command: string; arguments?: string; model?: string }, o?: Options) =>
        result(async () => {
          const [providerID, ...rest] = input.model?.split("/") ?? []
          await select(
            { ...input, model: providerID && rest.length ? { providerID, modelID: rest.join("/") } : undefined },
            o,
          )
          await raw.session.command(
            {
              sessionID: input.sessionID,
              name: input.command,
              text: input.arguments ?? "",
              files: files({ ...input, model: undefined }),
            },
            o,
          )
          return { info: undefined, parts: [] }
        }, o),
      abort: (input: Scope & { sessionID: string }, o?: Options) =>
        result(async () => {
          await raw.session.interrupt({ sessionID: input.sessionID }, o)
          return true
        }, o),
      summarize: (input: Scope & { sessionID: string }, o?: Options) =>
        result(async () => {
          await raw.session.compact({ sessionID: input.sessionID }, o)
          return true
        }, o),
      messages: (input: Scope & { sessionID: string; limit?: number; before?: string }, o?: Options) => {
        const next = { cursor: undefined as string | undefined }
        return result(
          async () => {
            const session = await raw.session.get({ sessionID: input.sessionID }, o)
            const ctx = {
              sessionID: session.id,
              directory: session.location.directory,
              agent: session.agent,
              model: session.model,
            }
            // limit 0 means every message, oldest first; otherwise one page that ends before the cursor.
            if (!input.limit) return messagesView(ctx, await all(raw, input.sessionID, o))
            const page = await raw.message.list(
              input.before
                ? { sessionID: input.sessionID, limit: input.limit, cursor: cursor(input.before) }
                : { sessionID: input.sessionID, limit: input.limit, order: "desc" },
              o,
            )
            next.cursor = page.cursor.next ?? undefined
            return messagesView(ctx, [...page.data].reverse())
          },
          o,
          (): Record<string, string> => (next.cursor ? { "X-Next-Cursor": next.cursor } : {}),
        )
      },
    },
  }

  return facade([], impl) as KiloClient
}

/**
 * Confirms that the server is a Kilo v2 host: `kilocode.handshake` is a Kilo RPC, so plain OpenCode fails here.
 * A failure is logged, not thrown: the event stream already connected, and the error surfaces in the log.
 */
export async function handshake(opts: Omit<V2Options, "directory">, directory: string) {
  const info = await OpenCode.make(opts)
    .rpc(KiloHandshakeRpc.Definition)
    .get({}, { location: { directory } })
    .catch((err: unknown) => {
      console.error("[Kilo New] v2: handshake failed:", err)
      return undefined
    })
  if (!info) return false
  console.log("[Kilo New] v2: handshake ok", info)
  return true
}

/** Every message of a session, oldest first. A cursor carries its own order; the server rejects both together. */
async function all(raw: OpenCodeClient, sessionID: string, o?: Options) {
  const pages = async (page: string | undefined, acc: Awaited<ReturnType<OpenCodeClient["message"]["list"]>>["data"][number][]): Promise<typeof acc> => {
    const chunk = await raw.message.list(page ? { sessionID, cursor: page } : { sessionID, order: "asc" }, o)
    const next = [...acc, ...chunk.data]
    if (!chunk.cursor.next) return next
    return pages(chunk.cursor.next, next)
  }
  return pages(undefined, [])
}

function decode(value: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>
  } catch (err) {
    console.warn("[Kilo New] v2: unreadable message cursor:", err)
    return undefined
  }
}

/**
 * Consumes `GET /api/event` and yields v1 global events. v2 sends SSE comments as keepalives; they surface as
 * `server.heartbeat` events so the adapter heartbeat timer sees activity, like the v1 server heartbeat.
 */
async function* stream(
  raw: OpenCodeClient,
  fold: V2Events,
  signal: AbortSignal | undefined,
  seen: (event: GlobalEvent) => void,
): AsyncGenerator<GlobalEvent> {
  const queue: GlobalEvent[] = []
  const state = { done: false, error: undefined as unknown, wake: Promise.withResolvers<void>(), last: Date.now() }
  const push = (items: GlobalEvent[]) => {
    state.last = Date.now()
    queue.push(...items)
    state.wake.resolve()
  }
  const pump = async () => {
    const iterator = raw.event.subscribe({
      signal,
      onActivity: () => {
        if (Date.now() - state.last > HEARTBEAT_MS) push([fold.heartbeat()])
      },
    })
    for await (const event of iterator) {
      const items = await fold.apply(event)
      items.forEach(seen)
      push(items)
    }
  }
  void pump().then(
    () => {
      state.done = true
      state.wake.resolve()
    },
    (error: unknown) => {
      state.done = true
      // An aborted fetch is a normal close (dispose, reconnect, or heartbeat timeout), as with the v1 SDK.
      if (!signal?.aborted) state.error = error
      state.wake.resolve()
    },
  )
  while (true) {
    while (queue.length) yield queue.shift()!
    if (state.done) break
    await state.wake.promise
    state.wake = Promise.withResolvers<void>()
  }
  if (state.error) throw state.error
}
