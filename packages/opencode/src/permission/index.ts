import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { ConfigPermission } from "@/config/permission"
import * as Config from "@/config/config" // kilocode_change
import { InstanceState } from "@/effect/instance-state"
import { ProjectID } from "@/project/schema"
import { MessageID, SessionID } from "@/session/schema"
import { PermissionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import { zod } from "@/util/effect-zod"
import * as Log from "@opencode-ai/core/util/log"
import { withStatics } from "@/util/schema"
import { Wildcard } from "@/util/wildcard"
import { Deferred, Effect, Layer, Schema, Context } from "effect"
import os from "os"
import z from "zod" // kilocode_change
import { evaluate as evalRule } from "./evaluate"
import { PermissionID } from "./schema"
import { makeRuntime } from "@/effect/run-service" // kilocode_change
import { ConfigProtection } from "@/kilocode/permission/config-paths" // kilocode_change
import { Identifier } from "@/id/id" // kilocode_change
import { drainCovered } from "@/kilocode/permission/drain" // kilocode_change
import { ExternalDirectoryPermission } from "@/kilocode/permission/external-directory" // kilocode_change

const log = Log.create({ service: "permission" })

export const Action = Schema.Literals(["allow", "deny", "ask"])
  .annotate({ identifier: "PermissionAction" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Action = Schema.Schema.Type<typeof Action>

export const Rule = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.String,
  action: Action,
})
  .annotate({ identifier: "PermissionRule" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Rule = Schema.Schema.Type<typeof Rule>

export const Ruleset = Schema.mutable(Schema.Array(Rule))
  .annotate({ identifier: "PermissionRuleset" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Ruleset = Schema.Schema.Type<typeof Ruleset>

export class Request extends Schema.Class<Request>("PermissionRequest")({
  id: PermissionID,
  sessionID: SessionID,
  permission: Schema.String,
  patterns: Schema.Array(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  always: Schema.Array(Schema.String),
  tool: Schema.optional(
    Schema.Struct({
      messageID: MessageID,
      callID: Schema.String,
    }),
  ),
}) {
  static readonly zod = zod(this)
}

export const Reply = Schema.Literals(["once", "always", "reject"]).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Reply = Schema.Schema.Type<typeof Reply>

const reply = {
  reply: Reply,
  message: Schema.optional(Schema.String),
}

export const ReplyBody = Schema.Struct(reply)
  .annotate({ identifier: "PermissionReplyBody" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ReplyBody = Schema.Schema.Type<typeof ReplyBody>

export class Approval extends Schema.Class<Approval>("PermissionApproval")({
  projectID: ProjectID,
  patterns: Schema.Array(Schema.String),
}) {
  static readonly zod = zod(this)
}

export const Event = {
  Asked: BusEvent.define("permission.asked", Request),
  Replied: BusEvent.define(
    "permission.replied",
    Schema.Struct({
      sessionID: SessionID,
      requestID: PermissionID,
      reply: Reply,
    }),
  ),
}

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionRejectedError", {}) {
  override get message() {
    return "The user rejected permission to use this specific tool call."
  }
}

export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionCorrectedError", {
  feedback: Schema.String,
}) {
  override get message() {
    return `The user rejected permission to use this specific tool call with the following feedback: ${this.feedback}`
  }
}

export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionDeniedError", {
  ruleset: Schema.Any,
}) {
  override get message() {
    return `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(this.ruleset)}`
  }
}

export type Error = DeniedError | RejectedError | CorrectedError

export const AskInput = Schema.Struct({
  ...Request.fields,
  id: Schema.optional(PermissionID),
  ruleset: Ruleset,
  hardRuleset: Schema.optional(Ruleset), // kilocode_change
})
  .annotate({ identifier: "PermissionAskInput" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type AskInput = Schema.Schema.Type<typeof AskInput>

export const ReplyInput = Schema.Struct({
  requestID: PermissionID,
  ...reply,
})
  .annotate({ identifier: "PermissionReplyInput" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ReplyInput = Schema.Schema.Type<typeof ReplyInput>

// kilocode_change start
export const SaveAlwaysRulesInput = z.object({
  requestID: PermissionID.zod,
  approvedAlways: z.string().array().optional(),
  deniedAlways: z.string().array().optional(),
})

export const AllowEverythingInput = z.object({
  enable: z.boolean(),
  requestID: Identifier.schema("permission").optional(),
  sessionID: Identifier.schema("session").optional(),
})
// kilocode_change end

export interface Interface {
  readonly ask: (input: AskInput) => Effect.Effect<void, Error>
  readonly reply: (input: ReplyInput) => Effect.Effect<boolean> // kilocode_change
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
  readonly saveAlwaysRules: (input: z.infer<typeof SaveAlwaysRulesInput>) => Effect.Effect<boolean> // kilocode_change
  readonly allowEverything: (input: z.infer<typeof AllowEverythingInput>) => Effect.Effect<void> // kilocode_change
  readonly pending: (id: string) => Effect.Effect<Request | undefined> // kilocode_change
}

interface PendingEntry {
  info: Request
  ruleset: Ruleset // kilocode_change
  hardRuleset?: Ruleset // kilocode_change
  saved?: boolean // kilocode_change
  deferred: Deferred.Deferred<void, RejectedError | CorrectedError>
}

interface State {
  pending: Map<PermissionID, PendingEntry>
  approved: Ruleset
  session: Record<string, Ruleset> // kilocode_change
}

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  log.info("evaluate", { permission, pattern, ruleset: rulesets.flat() })
  return evalRule(permission, pattern, ...rulesets)
}

// kilocode_change start
function veto(permission: string, pattern: string, ruleset?: Ruleset) {
  if (!ruleset) return false
  return ExternalDirectoryPermission.evaluate(permission, pattern, ruleset).action === "deny"
}

function subset(permission: string, ruleset: Ruleset) {
  return ruleset.filter((rule) => Wildcard.match(permission, rule.permission))
}
// kilocode_change end

export class Service extends Context.Service<Service, Interface>()("@opencode/Permission") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("Permission.state")(function* (ctx) {
        const row = Database.use((db) =>
          db.select().from(PermissionTable).where(eq(PermissionTable.project_id, ctx.project.id)).get(),
        )
        const state = {
          pending: new Map<PermissionID, PendingEntry>(),
          approved: row?.data ?? [],
          session: {} as Record<string, Ruleset>, // kilocode_change
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new RejectedError())
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    const ask = Effect.fn("Permission.ask")(function* (input: AskInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const { ruleset, hardRuleset, ...request } = input // kilocode_change
      const s = yield* InstanceState.get(state) // kilocode_change
      const local = s.session[request.sessionID] ?? [] // kilocode_change
      let needsAsk = false

      // kilocode_change start — force "ask" for config file edits
      const isProtected = ConfigProtection.isRequest(request)
      // kilocode_change end

      for (const pattern of request.patterns) {
        // kilocode_change start - external_directory allows must survive Ask/Plan hard rules
        const rule = hardRuleset
          ? ExternalDirectoryPermission.evaluate(request.permission, pattern, ruleset, approved, local)
          : evaluate(request.permission, pattern, ruleset, approved, local) // kilocode_change — include session-scoped rules
        // kilocode_change end
        log.info("evaluated", { permission: request.permission, pattern, action: rule })
        // kilocode_change start — saved/session approvals cannot override hard Ask/Plan denials
        if (veto(request.permission, pattern, hardRuleset)) {
          return yield* new DeniedError({ ruleset: subset(request.permission, hardRuleset ?? []) })
        }
        // kilocode_change end
        if (rule.action === "deny") {
          return yield* new DeniedError({
            ruleset: subset(request.permission, ruleset), // kilocode_change
          })
        }
        // kilocode_change start — override "allow" to "ask" for config paths
        if (rule.action === "allow" && !isProtected) continue
        // kilocode_change end
        needsAsk = true
      }

      if (!needsAsk) return

      const id = request.id ?? PermissionID.ascending()
      // kilocode_change start — inject disableAlways metadata for config paths
      const info = Schema.decodeUnknownSync(Request)({
        id,
        ...request,
        metadata: {
          ...request.metadata,
          ...(isProtected ? { [ConfigProtection.DISABLE_ALWAYS_KEY]: true } : {}),
        },
      })
      // kilocode_change end
      log.info("asking", { id, permission: info.permission, patterns: info.patterns })

      const deferred = yield* Deferred.make<void, RejectedError | CorrectedError>()
      pending.set(id, { info, ruleset, hardRuleset, deferred }) // kilocode_change
      yield* bus.publish(Event.Asked, info)
      return yield* Effect.ensuring(
        Deferred.await(deferred),
        Effect.sync(() => {
          pending.delete(id)
        }),
      )
    })

    const reply = Effect.fn("Permission.reply")(function* (input: ReplyInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const existing = pending.get(input.requestID)
      if (!existing) return false // kilocode_change

      pending.delete(input.requestID)
      yield* bus.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
      })

      if (input.reply === "reject") {
        yield* Deferred.fail(
          existing.deferred,
          input.message ? new CorrectedError({ feedback: input.message }) : new RejectedError(),
        )

        for (const [id, item] of pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          pending.delete(id)
          yield* bus.publish(Event.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: "reject",
          })
          yield* Deferred.fail(item.deferred, new RejectedError())
        }
        return true // kilocode_change
      }

      yield* Deferred.succeed(existing.deferred, undefined)
      if (input.reply === "once") return true // kilocode_change

      // kilocode_change start — downgrade "always" to "once" for config file edits
      if (ConfigProtection.isRequest(existing.info)) return true // kilocode_change
      // kilocode_change end

      for (const pattern of existing.info.always) {
        // kilocode_change start — saveAlwaysRules may have already persisted selected always-rules
        if (!existing.saved) {
          approved.push({
            permission: existing.info.permission,
            pattern,
            action: "allow",
          })
        }
        // kilocode_change end
      }

      // kilocode_change start — drain covered permissions across sibling Agent Manager sessions
      yield* drainCovered(pending as unknown as Map<string, PendingEntry>, approved, DeniedError)
      // kilocode_change end

      // kilocode_change start — persist always-rules to global config
      if (!existing.saved) {
        const alwaysRules: Ruleset = existing.info.always.map((pattern) => ({
          permission: existing.info.permission,
          pattern,
          action: "allow" as const,
        }))
        if (alwaysRules.length > 0) {
          yield* Effect.promise(() => Config.updateGlobal({ permission: toConfig(alwaysRules) }, { dispose: false }))
        }
      }
      // kilocode_change end
      return true // kilocode_change
    })

    const list = Effect.fn("Permission.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (item) => item.info)
    })

    // kilocode_change start
    const saveAlwaysRules = Effect.fn("Permission.saveAlwaysRules")(function* (
      input: z.infer<typeof SaveAlwaysRulesInput>,
    ) {
      const s = yield* InstanceState.get(state)
      const existing = s.pending.get(input.requestID)
      if (!existing) return false // kilocode_change

      if (ConfigProtection.isRequest(existing.info)) return true // kilocode_change

      const validRules = new Set([
        ...((existing.info.metadata?.rules as string[] | undefined) ?? []),
        ...existing.info.always,
      ])
      const permission = existing.info.permission

      const approvedSet = new Set(input.approvedAlways ?? [])
      const deniedSet = new Set(input.deniedAlways ?? [])
      const newRules: Ruleset = []
      for (const pattern of validRules) {
        if (approvedSet.has(pattern)) newRules.push({ permission, pattern, action: "allow" })
        if (deniedSet.has(pattern)) newRules.push({ permission, pattern, action: "deny" })
      }
      s.approved.push(...newRules)
      existing.saved = true // kilocode_change

      if (newRules.length > 0) {
        yield* Effect.promise(() => Config.updateGlobal({ permission: toConfig(newRules) }, { dispose: false }))
      }

      yield* drainCovered(
        s.pending as unknown as Map<string, PendingEntry>,
        s.approved,
        DeniedError,
        input.requestID as unknown as string,
      )
      return true
    })

    const allowEverything = Effect.fn("Permission.allowEverything")(function* (
      input: z.infer<typeof AllowEverythingInput>,
    ) {
      const s = yield* InstanceState.get(state)

      if (!input.enable) {
        if (input.sessionID) {
          delete s.session[input.sessionID]
          return
        }
        const idx = s.approved.findLastIndex((r) => r.permission === "*" && r.pattern === "*" && r.action === "allow")
        if (idx >= 0) s.approved.splice(idx, 1)
        return
      }

      const rule = { permission: "*", pattern: "*", action: "allow" } as const
      if (input.sessionID) s.session[input.sessionID] = [rule]
      else s.approved.push(rule)

      if (input.requestID) {
        const entry = s.pending.get(PermissionID.make(input.requestID))
        const ok = entry
          ? entry.info.patterns.every((pattern) => !veto(entry.info.permission, pattern, entry.hardRuleset))
          : false // kilocode_change
        if (entry && ok && (!input.sessionID || entry.info.sessionID === input.sessionID)) {
          s.pending.delete(PermissionID.make(input.requestID))
          yield* bus.publish(Event.Replied, {
            sessionID: entry.info.sessionID,
            requestID: entry.info.id,
            reply: "once",
          })
          yield* Deferred.succeed(entry.deferred, undefined)
        }
      }

      for (const [id, entry] of s.pending) {
        if (input.sessionID && entry.info.sessionID !== input.sessionID) continue
        if (ConfigProtection.isRequest(entry.info)) continue
        if (entry.info.patterns.some((pattern) => veto(entry.info.permission, pattern, entry.hardRuleset))) continue // kilocode_change
        s.pending.delete(id)
        yield* bus.publish(Event.Replied, {
          sessionID: entry.info.sessionID,
          requestID: entry.info.id,
          reply: "once",
        })
        yield* Deferred.succeed(entry.deferred, undefined)
      }
    })

    const pending = Effect.fn("Permission.pending")(function* (id: string) {
      const s = yield* InstanceState.get(state)
      return s.pending.get(PermissionID.make(id))?.info
    })
    // kilocode_change end

    return Service.of({ ask, reply, list, saveAlwaysRules, allowEverything, pending })
  }),
)

function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

export function fromConfig(permission: ConfigPermission.Info) {
  const ruleset: Ruleset = []
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      ruleset.push({ permission: key, action: value, pattern: "*" })
      continue
    }
    if (value === null) continue // kilocode_change — null is a delete sentinel
    ruleset.push(
      // kilocode_change start — filter out null entries (delete sentinels)
      ...Object.entries(value)
        .filter(([, action]) => action !== null)
        .map(([pattern, action]) => ({
          permission: key,
          pattern: expand(pattern),
          action: action as Action,
        })),
      // kilocode_change end
    )
  }
  return ruleset
}

export function merge(...rulesets: Ruleset[]): Ruleset {
  return rulesets.flat()
}

const EDIT_TOOLS = ["edit", "write", "apply_patch"]

export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  const result = new Set<string>()
  for (const tool of tools) {
    const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
    const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
    if (!rule) continue
    if (rule.pattern === "*" && rule.action === "deny") result.add(tool)
  }
  return result
}

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

// kilocode_change start — inverse of fromConfig: convert rules back to config format
const SCALAR_ONLY_PERMISSIONS = new Set([
  "todowrite",
  "todoread",
  "question",
  "webfetch",
  "websearch",
  "codesearch",
  "doom_loop",
])

export function toConfig(rules: Ruleset): ConfigPermission.Info {
  const result: ConfigPermission.Info = {}
  for (const rule of rules) {
    const existing = result[rule.permission]

    if (SCALAR_ONLY_PERMISSIONS.has(rule.permission)) {
      if (rule.pattern === "*") result[rule.permission] = rule.action
      continue
    }

    if (existing === undefined || existing === null) {
      result[rule.permission] = { [rule.pattern]: rule.action }
      continue
    }
    if (typeof existing === "string") {
      result[rule.permission] = { "*": existing, [rule.pattern]: rule.action }
      continue
    }
    result[rule.permission] = { ...existing, [rule.pattern]: rule.action }
  }
  return result
}
// kilocode_change end

// kilocode_change start - legacy promise helpers for Kilo callsites
const { runPromise } = makeRuntime(Service, defaultLayer)
export const list = () => runPromise((svc) => svc.list())
export const ask = (input: AskInput) => runPromise((svc) => svc.ask(input))
const replyPromise = (input: ReplyInput) => runPromise((svc) => svc.reply(input))
export { replyPromise as reply }
export const saveAlwaysRules = (input: z.infer<typeof SaveAlwaysRulesInput>) =>
  runPromise((svc) => svc.saveAlwaysRules(input))
export const allowEverything = (input: z.infer<typeof AllowEverythingInput>) =>
  runPromise((svc) => svc.allowEverything(input))
// kilocode_change end

export * as Permission from "."
