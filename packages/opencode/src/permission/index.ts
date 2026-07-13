import { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"
import * as Config from "@/config/config" // kilocode_change
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@opencode-ai/core/util/log"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { Deferred, Effect, Layer, Context } from "effect"
import os from "os"
import z from "zod" // kilocode_change
import { zod } from "@opencode-ai/core/effect-zod" // kilocode_change
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Database } from "@opencode-ai/core/database/database" // kilocode_change
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionID } from "@/session/schema" // kilocode_change - used by AllowEverythingInput
// kilocode_change start
import { ConfigProtection } from "@/kilocode/permission/config-paths"
import { KiloHeadless } from "@/kilocode/permission/headless"
import { drainCovered } from "@/kilocode/permission/drain"
import { ReadPermission } from "@/kilocode/permission/read"
import { ExternalDirectoryPermission } from "@/kilocode/permission/external-directory"
// kilocode_change end

const log = Log.create({ service: "permission" })

export const Event = {
  Asked: EventV2.define({ type: "permission.asked", schema: PermissionV1.Request.fields }),
  Replied: EventV2.define({
    type: "permission.replied",
    schema: {
      sessionID: PermissionV1.Request.fields.sessionID,
      requestID: PermissionV1.ID,
      reply: PermissionV1.Reply,
    },
  }),
}
// kilocode_change start - upstream moved these types into PermissionV1; re-export them here so existing
// Kilo callers that import off `Permission.*` keep working without a repo-wide rewrite
export const Rule = PermissionV1.Rule
export type Rule = PermissionV1.Rule
export const Ruleset = PermissionV1.Ruleset
export type Ruleset = PermissionV1.Ruleset
export const Action = PermissionV1.Action
export type Action = PermissionV1.Action
export const Request = PermissionV1.Request
export type Request = PermissionV1.Request
export const Reply = PermissionV1.Reply
export type Reply = PermissionV1.Reply
export const RejectedError = PermissionV1.RejectedError
export type RejectedError = PermissionV1.RejectedError
export const CorrectedError = PermissionV1.CorrectedError
export type CorrectedError = PermissionV1.CorrectedError
export const DeniedError = PermissionV1.DeniedError
export type DeniedError = PermissionV1.DeniedError
export const NotFoundError = PermissionV1.NotFoundError
export type NotFoundError = PermissionV1.NotFoundError
export type Error = PermissionV1.Error
export const ReplyInput = PermissionV1.ReplyInput
export type ReplyInput = PermissionV1.ReplyInput
// Kilo extends upstream's AskInput with an optional hardRuleset (consumed by drain + session/prompt)
export type AskInput = PermissionV1.AskInput & { hardRuleset?: PermissionV1.Ruleset }
// kilocode_change end

// kilocode_change start
export const SaveAlwaysRulesInput = z.object({
  requestID: zod(PermissionV1.ID),
  approvedAlways: z.string().array().optional(),
  deniedAlways: z.string().array().optional(),
})

export const AllowEverythingInput = z.object({
  enable: z.boolean(),
  requestID: zod(PermissionV1.ID).optional(),
  sessionID: zod(SessionID).optional(),
})
// kilocode_change end

export interface Interface {
  readonly ask: (input: AskInput) => Effect.Effect<void, Error>
  readonly reply: (input: ReplyInput) => Effect.Effect<void, NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
  // kilocode_change start
  readonly saveAlwaysRules: (input: z.infer<typeof SaveAlwaysRulesInput>) => Effect.Effect<void, NotFoundError>
  readonly allowEverything: (input: z.infer<typeof AllowEverythingInput>) => Effect.Effect<void>
  readonly pending: (id: string) => Effect.Effect<Request | undefined>
  // kilocode_change end
}

interface PendingEntry {
  info: Request
  // kilocode_change start
  ruleset: Ruleset
  hardRuleset?: Ruleset
  saved?: boolean
  // kilocode_change end
  deferred: Deferred.Deferred<void, RejectedError | CorrectedError>
}

interface State {
  pending: Map<PermissionV1.ID, PendingEntry>
  approved: Rule[]
  session: Record<string, Ruleset> // kilocode_change
}

export function evaluate(permission: string, pattern: string, ...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule {
  return (
    rulesets
      .flat()
      .findLast((rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)) ?? {
      action: "ask",
      permission,
      pattern: "*",
    }
  )
}

// kilocode_change start
export function resolve(permission: string, pattern: string, ruleset: Ruleset, ...overrides: Ruleset[]): Rule {
  const evalFn =
    permission === "external_directory"
      ? (permission: string, pattern: string, ...sets: Ruleset[]) =>
          ExternalDirectoryPermission.evaluate(permission, pattern, ...sets)
      : evaluate
  const base = ReadPermission.harden(permission, pattern, evalFn(permission, pattern, ruleset))
  const saved = evalFn(permission, pattern, ...overrides)
  if (base.action === "deny") return base
  if (saved.action === "deny") return saved
  if (base.action === "ask") {
    if (saved.action === "allow" && Wildcard.match(saved.pattern, base.pattern)) return saved
    return base
  }
  if (saved.action === "allow") return saved
  return base
}

function veto(permission: string, pattern: string, ruleset?: Ruleset) {
  if (!ruleset) return false
  return ExternalDirectoryPermission.evaluate(permission, pattern, ruleset).action === "deny"
}

function subset(permission: string, ruleset: Ruleset) {
  return ruleset.filter((rule) => Wildcard.match(permission, rule.permission))
}

function covered(entry: PendingEntry, approved: Ruleset, local: Ruleset) {
  if (ConfigProtection.isRequest(entry.info)) return false
  return entry.info.patterns.every((pattern) => {
    if (veto(entry.info.permission, pattern, entry.hardRuleset)) return false
    return resolve(entry.info.permission, pattern, entry.ruleset, approved, local).action === "allow"
  })
}
// kilocode_change end

export class Service extends Context.Service<Service, Interface>()("@opencode/Permission") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const config = yield* Config.Service // kilocode_change
    const database = yield* Database.Service // kilocode_change
    const state = yield* InstanceState.make<State>(
      Effect.fn("Permission.state")(function* (ctx) {
        void ctx
        const state = {
          pending: new Map<PermissionV1.ID, PendingEntry>(),
          approved: [] as Rule[], // kilocode_change - upstream dropped DB-seeded approvals; Kilo persists via config.updateGlobal
          session: {} as Record<string, Ruleset>, // kilocode_change
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new PermissionV1.RejectedError())
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    const ask = Effect.fn("Permission.ask")(function* (input: AskInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      // kilocode_change start
      const { ruleset, hardRuleset, ...request } = input
      const s = yield* InstanceState.get(state)
      const local = s.session[request.sessionID] ?? []
      // kilocode_change end
      let needsAsk = false

      // kilocode_change start - protect config access while honoring explicit global skill trust
      const isProtected = ConfigProtection.isRequest(request)
      const skill = ConfigProtection.globalSkillPattern(request)
      const trusted = skill
        ? yield* config.getGlobal().pipe(
            Effect.map((global) => fromConfig(global.permission ?? {})),
            Effect.map((rules) =>
              request.patterns.every((pattern) => {
                const rule = ExternalDirectoryPermission.evaluate(request.permission, pattern, rules)
                return rule.action === "allow" && rule.pattern === skill
              }),
            ),
            Effect.catch(() => Effect.succeed(false)),
          )
        : false
      // kilocode_change end

      for (const pattern of request.patterns) {
        const rule = resolve(request.permission, pattern, ruleset, approved, local) // kilocode_change - include session-scoped rules
        log.info("evaluated", { permission: request.permission, pattern, action: rule })
        // kilocode_change start - saved/session approvals cannot override hard Ask/Plan denials
        if (veto(request.permission, pattern, hardRuleset)) {
          return yield* new DeniedError({ ruleset: subset(request.permission, hardRuleset ?? []) })
        }
        // kilocode_change end
        if (rule.action === "deny") {
          return yield* new DeniedError({
            ruleset: subset(request.permission, ruleset), // kilocode_change
          })
        }
        // kilocode_change start - override "allow" to "ask" for protected config paths
        if (rule.action === "allow" && (!isProtected || trusted)) continue
        // kilocode_change end
        needsAsk = true
      }

      if (!needsAsk) return

      // kilocode_change start - headless subagent asks fail instead of queuing for a reply that never comes (#11903)
      if (yield* KiloHeadless.denies(request.sessionID).pipe(Effect.provideService(Database.Service, database))) {
        return yield* new DeniedError({ ruleset: subset(request.permission, ruleset) })
      }
      // kilocode_change end

      const id = request.id ?? PermissionV1.ID.ascending()
      const info: PermissionV1.Request = {
        id,
        sessionID: request.sessionID,
        permission: request.permission,
        patterns: request.patterns,
        // kilocode_change start - disable persistence for protected config paths outside one exact global skill
        metadata: {
          ...request.metadata,
          ...(skill ? { rules: [skill] } : {}),
          ...(isProtected && skill === undefined
            ? { [ConfigProtection.DISABLE_ALWAYS_KEY]: true, [ConfigProtection.CONFIG_PROTECTED_KEY]: true }
            : {}),
        },
        // kilocode_change end
        always: skill ? [skill] : request.always, // kilocode_change - persist only the exact global skill subtree
        tool: request.tool,
      }
      log.info("asking", { id, permission: info.permission, patterns: info.patterns })

      const deferred = yield* Deferred.make<void, RejectedError | CorrectedError>()
      pending.set(id, { info, ruleset, hardRuleset, deferred }) // kilocode_change
      yield* events.publish(Event.Asked, info) // kilocode_change - was bus.publish
      return yield* Effect.ensuring(
        Deferred.await(deferred),
        Effect.sync(() => {
          pending.delete(id)
        }),
      )
    })

    const reply = Effect.fn("Permission.reply")(function* (input: PermissionV1.ReplyInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const existing = pending.get(input.requestID)
      if (!existing) return yield* new PermissionV1.NotFoundError({ requestID: input.requestID })

      pending.delete(input.requestID)
      yield* events.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
      })

      if (input.reply === "reject") {
        yield* Deferred.fail(
          existing.deferred,
          input.message
            ? new PermissionV1.CorrectedError({ feedback: input.message })
            : new PermissionV1.RejectedError(),
        )

        for (const [id, item] of pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          pending.delete(id)
          yield* events.publish(Event.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: "reject",
          })
          yield* Deferred.fail(item.deferred, new PermissionV1.RejectedError())
        }
        return
      }

      yield* Deferred.succeed(existing.deferred, undefined)
      if (input.reply === "once") return

      // kilocode_change start - downgrade "always" to "once" for protected config paths
      if (ConfigProtection.isRequest(existing.info) && !ConfigProtection.isGlobalSkillRequest(existing.info)) return
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
      }

      yield* drainCovered(pending as unknown as Map<string, PendingEntry>, approved, (data) =>
        Effect.asVoid(events.publish(Event.Replied, data)),
      ) // kilocode_change - drain publishes replies through the same EventV2Bridge channel

      if (!existing.saved) {
        const alwaysRules: Ruleset = existing.info.always.map((pattern) => ({
          permission: existing.info.permission,
          pattern,
          action: "allow" as const,
        }))
        if (alwaysRules.length > 0) {
          yield* config.updateGlobal({ permission: toConfig(alwaysRules) }, { dispose: false })
        }
      }
      // kilocode_change end
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
      if (!existing) return yield* new NotFoundError({ requestID: input.requestID })

      if (ConfigProtection.isRequest(existing.info) && !ConfigProtection.isGlobalSkillRequest(existing.info)) return

      const skill = ConfigProtection.globalSkillPattern(existing.info)
      const validRules = new Set(
        skill ? [skill] : [...((existing.info.metadata?.rules as string[] | undefined) ?? []), ...existing.info.always],
      )
      const permission = existing.info.permission

      const approvedSet = new Set(input.approvedAlways ?? [])
      const deniedSet = new Set(input.deniedAlways ?? [])
      const newRules: Rule[] = []
      for (const pattern of validRules) {
        if (approvedSet.has(pattern)) newRules.push({ permission, pattern, action: "allow" })
        if (deniedSet.has(pattern)) newRules.push({ permission, pattern, action: "deny" })
      }
      s.approved.push(...newRules)
      existing.saved = true

      if (newRules.length > 0) {
        yield* config.updateGlobal({ permission: toConfig(newRules) }, { dispose: false })
      }

      // kilocode_change - drain publishes replies through the same EventV2Bridge channel (was DeniedError)
      yield* drainCovered(
        s.pending as unknown as Map<string, PendingEntry>,
        s.approved,
        (data) => Effect.asVoid(events.publish(Event.Replied, data)),
        input.requestID as unknown as string,
      )
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
        const entry = s.pending.get(input.requestID)
        const ok = entry ? covered(entry, s.approved, s.session[entry.info.sessionID] ?? []) : false
        if (entry && ok && (!input.sessionID || entry.info.sessionID === input.sessionID)) {
          s.pending.delete(input.requestID)
          yield* events.publish(Event.Replied, {
            sessionID: entry.info.sessionID,
            requestID: entry.info.id,
            reply: "once",
          })
          yield* Deferred.succeed(entry.deferred, undefined)
        }
      }

      for (const [id, entry] of s.pending) {
        if (input.sessionID && entry.info.sessionID !== input.sessionID) continue
        if (!covered(entry, s.approved, s.session[entry.info.sessionID] ?? [])) continue
        s.pending.delete(id)
        yield* events.publish(Event.Replied, {
          sessionID: entry.info.sessionID,
          requestID: entry.info.id,
          reply: "once",
        })
        yield* Deferred.succeed(entry.deferred, undefined)
      }
    })

    const pending = Effect.fn("Permission.pending")(function* (id: string) {
      const s = yield* InstanceState.get(state)
      return s.pending.get(PermissionV1.ID.make(id))?.info
    })
    // kilocode_change end

    return Service.of({ ask, reply, list, saveAlwaysRules, allowEverything, pending }) // kilocode_change
  }),
)

function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

export function fromConfig(permission: ConfigPermissionV1.Info) {
  const ruleset: PermissionV1.Rule[] = []
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

export function merge(...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule[] {
  return rulesets.flat()
}

export function disabled(tools: string[], ruleset: PermissionV1.Ruleset): Set<string> {
  const edits = ["edit", "write", "apply_patch"]
  return new Set(
    tools.filter((tool) => {
      const permission = edits.includes(tool) ? "edit" : tool
      const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
      return rule?.pattern === "*" && rule.action === "deny"
    }),
  )
}

// kilocode_change start - Kilo permission persistence and headless ancestry dependencies
export const defaultLayer = layer.pipe(
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Database.defaultLayer),
)
// kilocode_change end

// kilocode_change start — inverse of fromConfig: convert rules back to config format
const SCALAR_ONLY_PERMISSIONS = new Set(["todowrite", "todoread", "question", "webfetch", "websearch", "doom_loop"])

export function toConfig(rules: Ruleset): ConfigPermissionV1.Info {
  const result: ConfigPermissionV1.Info = {}
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

export * as Permission from "."
