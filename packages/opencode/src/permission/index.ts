import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { ProjectID } from "@/project/schema"
import { Instance } from "@/project/instance"
import { MessageID, SessionID } from "@/session/schema"
import { PermissionTable } from "@/session/session.sql"
import { Database, eq } from "@/storage/db"
import { Log } from "@/util/log"
import { Wildcard } from "@/util/wildcard"
import { Deferred, Effect, Layer, Schema, ServiceMap } from "effect"
import os from "os"
import z from "zod"
import { evaluate as evalRule } from "./evaluate"
import { PermissionID } from "./schema"
import { ConfigProtection } from "@/kilocode/permission/config-paths" // kilocode_change
import { Identifier } from "@/id/id" // kilocode_change
import { drainCovered } from "@/kilocode/permission/drain" // kilocode_change

export namespace Permission {
  const log = Log.create({ service: "permission" })

  export const Action = z.enum(["allow", "deny", "ask"]).meta({
    ref: "PermissionAction",
  })
  export type Action = z.infer<typeof Action>

  export const Rule = z
    .object({
      permission: z.string(),
      pattern: z.string(),
      action: Action,
    })
    .meta({
      ref: "PermissionRule",
    })
  export type Rule = z.infer<typeof Rule>

  export const Ruleset = Rule.array().meta({
    ref: "PermissionRuleset",
  })
  export type Ruleset = z.infer<typeof Ruleset>

  export const Request = z
    .object({
      id: PermissionID.zod,
      sessionID: SessionID.zod,
      permission: z.string(),
      patterns: z.string().array(),
      metadata: z.record(z.string(), z.any()),
      always: z.string().array(),
      tool: z
        .object({
          messageID: MessageID.zod,
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "PermissionRequest",
    })
  export type Request = z.infer<typeof Request>

  export const Reply = z.enum(["once", "always", "reject"])
  export type Reply = z.infer<typeof Reply>

  export const Approval = z.object({
    projectID: ProjectID.zod,
    patterns: z.string().array(),
  })

  export const Event = {
    Asked: BusEvent.define("permission.asked", Request),
    Replied: BusEvent.define(
      "permission.replied",
      z.object({
        sessionID: SessionID.zod,
        requestID: PermissionID.zod,
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

  export const AskInput = Request.partial({ id: true }).extend({
    ruleset: Ruleset,
  })

  export const ReplyInput = z.object({
    requestID: PermissionID.zod,
    reply: Reply,
    message: z.string().optional(),
  })

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
    readonly ask: (input: z.infer<typeof AskInput>) => Effect.Effect<void, Error>
    readonly reply: (input: z.infer<typeof ReplyInput>) => Effect.Effect<void>
    readonly list: () => Effect.Effect<Request[]>
    readonly saveAlwaysRules: (input: z.infer<typeof SaveAlwaysRulesInput>) => Effect.Effect<void> // kilocode_change
    readonly allowEverything: (input: z.infer<typeof AllowEverythingInput>) => Effect.Effect<void> // kilocode_change
    readonly pending: (id: string) => Effect.Effect<Request | undefined> // kilocode_change
  }

  interface PendingEntry {
    info: Request
    ruleset: Ruleset // kilocode_change
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

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Permission") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
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

      const ask = Effect.fn("Permission.ask")(function* (input: z.infer<typeof AskInput>) {
        const { approved, pending } = yield* InstanceState.get(state)
        const { ruleset, ...request } = input
        const s = yield* InstanceState.get(state) // kilocode_change
        const local = s.session[request.sessionID] ?? [] // kilocode_change
        let needsAsk = false

        // kilocode_change start — force "ask" for config file edits
        const isProtected = ConfigProtection.isRequest(request)
        // kilocode_change end

        for (const pattern of request.patterns) {
          const rule = evaluate(request.permission, pattern, ruleset, approved)
          log.info("evaluated", { permission: request.permission, pattern, action: rule })
          if (rule.action === "deny") {
            return yield* new DeniedError({
              ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
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
        const info: Request = {
          id,
          ...request,
          metadata: {
            ...request.metadata,
            ...(isProtected ? { [ConfigProtection.DISABLE_ALWAYS_KEY]: true } : {}),
          },
        }
        // kilocode_change end
        log.info("asking", { id, permission: info.permission, patterns: info.patterns })

        const deferred = yield* Deferred.make<void, RejectedError | CorrectedError>()
        s.pending.set(id, { info, ruleset, deferred }) // kilocode_change — store ruleset
        void Bus.publish(Event.Asked, info)
        return yield* Effect.ensuring(
          Deferred.await(deferred),
          Effect.sync(() => {
            s.pending.delete(id)
          }),
        )
      })

      const reply = Effect.fn("Permission.reply")(function* (input: z.infer<typeof ReplyInput>) {
        const { approved, pending } = yield* InstanceState.get(state)
        const existing = pending.get(input.requestID)
        if (!existing) return

        pending.delete(input.requestID)
        void Bus.publish(Event.Replied, {
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
            void Bus.publish(Event.Replied, {
              sessionID: item.info.sessionID,
              requestID: item.info.id,
              reply: "reject",
            })
            yield* Deferred.fail(item.deferred, new RejectedError())
          }
          return
        }

        yield* Deferred.succeed(existing.deferred, undefined)
        if (input.reply === "once") return

        // kilocode_change start — downgrade "always" to "once" for config file edits
        if (ConfigProtection.isRequest(existing.info)) return
        // kilocode_change end

        for (const pattern of existing.info.always) {
          approved.push({
            permission: existing.info.permission,
            pattern,
            action: "allow",
          })
        }

        for (const [id, item] of pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          const ok = item.info.patterns.every(
            (pattern) => evaluate(item.info.permission, pattern, item.ruleset, approved).action === "allow", // kilocode_change — include original ruleset
          )
          if (!ok) continue
          pending.delete(id)
          void Bus.publish(Event.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: "always",
          })
          yield* Deferred.succeed(item.deferred, undefined)
        }

        // kilocode_change start — persist always-rules to global config
        const alwaysRules: Ruleset = existing.info.always.map((pattern) => ({
          permission: existing.info.permission,
          pattern,
          action: "allow" as const,
        }))
        if (alwaysRules.length > 0) {
          yield* Effect.promise(() => Config.updateGlobal({ permission: toConfig(alwaysRules) }, { dispose: false }))
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
        if (!existing) return

        if (ConfigProtection.isRequest(existing.info)) return

        const validRules = new Set([...(existing.info.metadata?.rules ?? []), ...existing.info.always])
        const permission = existing.info.permission

        const approvedSet = new Set(input.approvedAlways ?? [])
        const deniedSet = new Set(input.deniedAlways ?? [])
        const newRules: Ruleset = []
        for (const pattern of validRules) {
          if (approvedSet.has(pattern)) newRules.push({ permission, pattern, action: "allow" })
          if (deniedSet.has(pattern)) newRules.push({ permission, pattern, action: "deny" })
        }
        s.approved.push(...newRules)

        if (newRules.length > 0) {
          yield* Effect.promise(() => Config.updateGlobal({ permission: toConfig(newRules) }, { dispose: false }))
        }

        yield* drainCovered(
          s.pending as unknown as Map<string, PendingEntry>,
          s.approved,
          DeniedError,
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
          const entry = s.pending.get(PermissionID.make(input.requestID))
          if (entry && (!input.sessionID || entry.info.sessionID === input.sessionID)) {
            s.pending.delete(PermissionID.make(input.requestID))
            void Bus.publish(Event.Replied, {
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
          s.pending.delete(id)
          void Bus.publish(Event.Replied, {
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

  export function fromConfig(permission: Config.Permission) {
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

  const EDIT_TOOLS = ["edit", "write", "apply_patch", "multiedit"]

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

  export const { runPromise } = makeRuntime(Service, layer)

  export async function ask(input: z.infer<typeof AskInput>) {
    return runPromise((s) => s.ask(input))
  }

  export async function reply(input: z.infer<typeof ReplyInput>) {
    return runPromise((s) => s.reply(input))
  }

  export async function list() {
    return runPromise((s) => s.list())
  }

  // kilocode_change start
  export async function saveAlwaysRules(input: z.infer<typeof SaveAlwaysRulesInput>) {
    return runPromise((s) => s.saveAlwaysRules(input))
  }

  export async function allowEverything(input: z.infer<typeof AllowEverythingInput>) {
    return runPromise((s) => s.allowEverything(input))
  }

  export async function pending(id: string) {
    return runPromise((s) => s.pending(id))
  }

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

  export function toConfig(rules: Ruleset): Config.Permission {
    const result: Config.Permission = {}
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
      existing[rule.pattern] = rule.action
    }
    return result
  }
  // kilocode_change end
}
