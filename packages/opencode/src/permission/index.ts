import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder" // kilocode_change
import { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"
import * as Config from "@/config/config" // kilocode_change
import { InstanceState } from "@/effect/instance-state"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { Deferred, Effect, Exit, Layer, Context } from "effect"
import os from "os"
import z from "zod" // kilocode_change
import { zod } from "@opencode-ai/core/effect-zod" // kilocode_change
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Database } from "@opencode-ai/core/database/database" // kilocode_change
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionID } from "@/session/schema" // kilocode_change - used by AllowEverythingInput
// kilocode_change start
import { ConfigProtection } from "@/kilocode/permission/config-paths"
import { KiloHeadless } from "@/kilocode/permission/headless"
import { drainCovered } from "@/kilocode/permission/drain"
import { ReadPermission } from "@/kilocode/permission/read"
import { AgentManagerPermission } from "@/kilocode/permission/agent-manager" // kilocode_change
import { ExternalDirectoryPermission } from "@/kilocode/permission/external-directory"
import { KiloSecurityGate } from "@/kilocode/security-decision/gate"
import { PermissionHumanOnly } from "@/kilocode/permission/human-only" // kilocode_change
import { SecurityBlocked } from "@/kilocode/security-decision/block"
import { SecurityDecisionAdapter } from "@/kilocode/security-decision/adapter"
import { SecurityAsk } from "@/kilocode/security-decision/ask"
import type { SecurityDecisionTypes } from "@/kilocode/security-decision/types"
// kilocode_change end

export const Event = PermissionV1.Event
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
export type Error = PermissionV1.Error | SecurityBlocked.Error // kilocode_change - typed security block
export const ReplyInput = PermissionV1.ReplyInput
export type ReplyInput = PermissionV1.ReplyInput
// Kilo extends upstream's AskInput with an optional hardRuleset (consumed by drain + session/prompt)
export type AskInput = PermissionV1.AskInput & {
  source?: "builtin" | "mcp" | "unknown"
  hardRuleset?: PermissionV1.Ruleset
  /** Live containment facts for the security decision layer; never published to clients. */
  containment?: SecurityDecisionTypes.Containment
  /** The agent identity this ask was resolved against. */
  agent?: string
  /** True when this exact tool call was already stopped by the security layer earlier in the turn. */
  blocked?: boolean
  /**
   * Re-reads the confinement facts. The security layer calls it after the reviewer answers, so a
   * sandbox toggled during the review cannot be the evidence an approval was granted on.
   */
  containmentLive?: () => Effect.Effect<SecurityDecisionTypes.Containment>
  /**
   * Re-reads the agent and session rulesets. Same reason: the ruleset a verdict was computed under
   * has to still be the ruleset in force when the verdict is applied.
   */
  authorization?: () => Effect.Effect<{
    ruleset: PermissionV1.Ruleset
    hardRuleset?: PermissionV1.Ruleset
    agent?: string
  }>
  /**
   * Sink for the security layer's audit record. Called with the *initial* record before the call is
   * auto-approved or published as an ask, so a rejected or abandoned ask is still audited.
   */
  audit?: (record: SecurityDecisionAdapter.Audit) => Effect.Effect<void>
}
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

// kilocode_change start - describe why a call was allowed so clients can explain auto-approval
export interface AskOutcome {
  /** true when the user was prompted and replied; false when a rule auto-approved. */
  manual: boolean
  /** The winning rule (carries an optional `source` marker set at ruleset-build time). */
  rule?: Rule
  /** Audit record of the deterministic security layer, when the feature flag is on. */
  security?: SecurityDecisionAdapter.Audit
  /** For a manual outcome: whether a human actually answered, or a client replied on their behalf. */
  readonly interactive?: boolean // kilocode_change
}
// kilocode_change end

export interface Interface {
  readonly ask: (input: AskInput) => Effect.Effect<AskOutcome, Error> // kilocode_change - was Effect<void>; returns the decision
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
  /**
   * Set by `reply` when a human or a client actually rejected this request, so `ask` can tell an
   * answered rejection from a session teardown that fails every pending deferred at once.
   */
  rejection?: { interactive: boolean }
  /**
   * Set by `reply` when this request was approved, recording whether a human actually answered.
   * Auto mode replies from the client without `interactive`, and an approval nobody looked at must
   * not be reported back as one the user gave.
   */
  approval?: { interactive: boolean }
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
  const base = AgentManagerPermission.harden(
    permission,
    pattern,
    ReadPermission.harden(permission, pattern, evalFn(permission, pattern, ruleset)),
  ) // kilocode_change
  const saved = AgentManagerPermission.harden(permission, pattern, evalFn(permission, pattern, ...overrides)) // kilocode_change
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
  if (entry.info.metadata?.["skillShell"] === true) return false // kilocode_change - skill batch needs an explicit reply
  if (entry.info.metadata?.["sandboxEscalation"] === true) return false // kilocode_change - host access needs an explicit reply
  if (SecurityAsk.is(entry.info.metadata)) return false // kilocode_change - a security-raised ask is never auto-approved
  return entry.info.patterns.every((pattern) => {
    if (veto(entry.info.permission, pattern, entry.hardRuleset)) return false
    return resolve(entry.info.permission, pattern, entry.ruleset, approved, local).action === "allow"
  })
}
// kilocode_change end

export class Service extends Context.Service<Service, Interface>()("@opencode/Permission") {}

const layer = Layer.effect(
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
      const { ruleset, hardRuleset, containment, containmentLive, authorization, agent, blocked, audit, source, ...request } =
        input
      const s = yield* InstanceState.get(state)
      const local = s.session[request.sessionID] ?? []
      // kilocode_change end
      let needsAsk = false
      let approvedRule: Rule | undefined // kilocode_change - remember the rule that auto-approved

      // kilocode_change start - protect config access while honoring explicit global skill trust
      const isProtected = ConfigProtection.isRequest(request)
      const skill = ConfigProtection.globalSkillPattern(request)
      // kilocode_change - factored so the security layer can re-run the same trust test against
      // freshly read state after its reviewer awaits, instead of reusing this one's answer
      const trustedFor = Effect.fn("Permission.trusted")(function* (rules: Rule[]) {
        if (!skill) return false
        const direct = ExternalDirectoryPermission.evaluate(request.permission, skill, rules)
        if (direct.action === "allow" && direct.pattern === skill) return true
        return yield* config.getGlobal().pipe(
          Effect.map((global) => fromConfig(global.permission ?? {})),
          Effect.map((globalRules) => {
            const rule = ExternalDirectoryPermission.evaluate(request.permission, skill, globalRules)
            return rule.action === "allow" && rule.pattern === skill
          }),
          Effect.catch(() => Effect.succeed(false)),
        )
      })
      const trusted = yield* trustedFor(approved)
      // kilocode_change end

      const forceAsk = request.metadata?.["skillShell"] === true || request.metadata?.["sandboxEscalation"] === true // kilocode_change
      const resolved: KiloSecurityGate.Resolved[] = [] // kilocode_change - fed to the security decision layer below
      for (const pattern of request.patterns) {
        const rule = resolve(request.permission, pattern, ruleset, approved, local) // kilocode_change — include session-scoped rules
        resolved.push({ pattern, action: rule.action }) // kilocode_change
        yield* Effect.logInfo("evaluated", { permission: request.permission, pattern, action: rule })
        // kilocode_change start — saved/session approvals cannot override hard Ask/Plan denials
        if (veto(request.permission, pattern, hardRuleset)) {
          return yield* new DeniedError({ ruleset: subset(request.permission, hardRuleset ?? []) })
        }
        // kilocode_change end
        if (rule.action === "deny") {
          // kilocode_change - carry the deciding rule (not just the permission subset) for provenance
          return yield* new DeniedError({ ruleset: rule })
        }
        // kilocode_change start - skill shell forces a prompt instead of honoring an allow/auto-approve rule
        if (forceAsk) {
          needsAsk = true
          continue
        }
        // kilocode_change end
        // kilocode_change start - override "allow" to "ask" for protected config paths
        if (rule.action === "allow" && (!isProtected || trusted)) {
          approvedRule = rule // remember the winning rule so callers can explain the auto-approval
          continue
        }
        // kilocode_change end
        needsAsk = true
      }

      // kilocode_change start - deterministic security decision layer (single authoritative hook).
      // Runs after the hard veto, the explicit deny and the human-only guards, and before the
      // auto-return/pending split. It is monotonic: it may raise an allow to ask or block a proven
      // destructive call, never the reverse, and it is inert while the feature flag is off.
      // kilocode_change - a fresh read of everything the decision rests on. The security layer calls
      // it only after its reviewer answers, so nothing here runs on the ordinary path.
      const live = Effect.fn("Permission.live")(function* () {
        const fresh = authorization ? yield* authorization() : undefined
        const rules = fresh?.ruleset ?? ruleset
        const now = yield* InstanceState.get(state)
        const session = now.session[request.sessionID] ?? []
        const resolvedNow: KiloSecurityGate.Resolved[] = request.patterns.map((pattern) => ({
          pattern,
          action: resolve(request.permission, pattern, rules, now.approved, session).action,
        }))
        const trustedNow = yield* trustedFor(now.approved)
        const containmentNow = containmentLive ? yield* containmentLive() : containment
        return {
          resolved: resolvedNow,
          humanOnly: forceAsk || (isProtected && !trustedNow),
          ...(containmentNow ? { containment: containmentNow } : {}),
          ...((fresh?.agent ?? agent) ? { agent: fresh?.agent ?? agent } : {}),
        }
      })
      const security = SecurityDecisionAdapter.enabled()
        ? yield* KiloSecurityGate.evaluate({
            config,
            source,
            workspace: (yield* InstanceState.context).worktree,
            permission: request.permission,
            patterns: request.patterns,
            metadata: request.metadata,
            sessionID: request.sessionID,
            callID: request.tool?.callID,
            resolved,
            humanOnly: forceAsk || (isProtected && !trusted),
            containment,
            ...(agent ? { agent } : {}),
            ...(blocked ? { blocked } : {}),
            live,
            ...(audit ? { audit } : {}), // kilocode_change - surface the reviewer stage while it runs
          })
        : undefined
      // The initial record is written before any effect: an ask that is never answered, or is
      // rejected, still leaves an audit trail behind.
      if (security && audit) {
        yield* audit(
          SecurityDecisionAdapter.finalize(
            security.audit,
            security.decision === "deny" ? "deny" : security.decision === "ask" || needsAsk ? "ask_pending" : "allow",
            "security",
          ),
        )
      }
      if (security?.decision === "deny") {
        return yield* SecurityBlocked.of(
          security.rule_id,
          SecurityDecisionAdapter.finalize(security.audit, "deny", "security"),
        )
      }
      // Provenance: *any* ask the layer decided on is a security decision, even when the existing
      // pipeline already needed an ask of its own. Every automated path keys off this, so nothing
      // can approve it by mistaking it for an ordinary ask.
      const securityAsk = security?.decision === "ask"
      // Enforcement: only an ask the layer raised by itself carries the security reject semantics.
      // An ask the pipeline already needed (a rule, a skill batch, a protected config path) keeps
      // Kilo's ordinary reject semantics.
      const securityRaisedAsk = securityAsk && !needsAsk
      if (securityAsk) needsAsk = true
      // kilocode_change end

      if (!needsAsk)
        return {
          manual: false,
          rule: approvedRule,
          // kilocode_change - carry the audit so the tool adapter can persist it
          ...(security ? { security: SecurityDecisionAdapter.finalize(security.audit, "allow", "rule") } : {}),
        }

      // kilocode_change start - headless subagent asks fail instead of queuing for a reply that never comes (#11903)
      if (yield* KiloHeadless.denies(request.sessionID).pipe(Effect.provideService(Database.Service, database))) {
        // kilocode_change - an unanswerable ask the security layer raised is a block, not a silent deny
        if (securityAsk && security) {
          return yield* SecurityBlocked.of(
            security.rule_id,
            SecurityDecisionAdapter.finalize(security.audit, "blocked", "security"),
          )
        }
        return yield* new DeniedError({ ruleset: subset(request.permission, ruleset) })
      }
      // kilocode_change end

      const id = request.id ?? PermissionV1.ID.ascending()
      const info: PermissionV1.Request = {
        id,
        sessionID: request.sessionID,
        permission: request.permission,
        patterns: request.patterns,
        // kilocode_change start - disable persistence for protected config paths outside one exact global skill,
        // and tag a security-raised ask so no client can auto-approve it
        metadata: {
          ...request.metadata,
          ...(skill ? { rules: [skill] } : {}),
          ...(isProtected && skill === undefined
            ? { [ConfigProtection.DISABLE_ALWAYS_KEY]: true, [ConfigProtection.CONFIG_PROTECTED_KEY]: true }
            : {}),
          ...(securityAsk && security ? SecurityAsk.mark({}, { rule_id: security.rule_id }) : {}),
        },
        // kilocode_change end
        always: skill ? [skill] : request.always, // kilocode_change - persist only the exact global skill subtree
        tool: request.tool,
      }
      yield* Effect.logInfo("asking", { id, permission: info.permission, patterns: info.patterns })

      const deferred = yield* Deferred.make<void, RejectedError | CorrectedError>()
      const entry: PendingEntry = { info, ruleset, hardRuleset, deferred } // kilocode_change
      pending.set(id, entry) // kilocode_change
      yield* events.publish(Event.Asked, info) // kilocode_change - was bus.publish
      // kilocode_change start - a security-raised ask enforces the security outcome itself: a rejection
      // blocks this one call with the fixed result instead of failing the turn like an ordinary reject.
      if (securityRaisedAsk && security) {
        const exit = yield* Effect.ensuring(
          Deferred.await(deferred),
          Effect.sync(() => {
            pending.delete(id)
          }),
        ).pipe(Effect.exit)
        if (Exit.isSuccess(exit)) {
          // kilocode_change - the audit names the same answerer the approval marker does
          const answered = entry.approval?.interactive === true
          return {
            manual: true,
            interactive: answered,
            security: SecurityDecisionAdapter.finalize(security.audit, "allow", answered ? "manual" : "auto"),
          }
        }
        // Only an answered rejection is enforcement; a session teardown keeps its existing semantics.
        if (!entry.rejection) return yield* Effect.failCause(exit.cause)
        const record = SecurityDecisionAdapter.finalize(
          security.audit,
          entry.rejection.interactive ? "reject" : "blocked",
          "security",
        )
        if (audit) yield* audit(record)
        return yield* SecurityBlocked.of(security.rule_id, record)
      }
      // kilocode_change end
      // kilocode_change start - was `return yield* Effect.ensuring(...)`; report the manual decision to callers
      yield* Effect.ensuring(
        Deferred.await(deferred),
        Effect.sync(() => {
          pending.delete(id)
        }),
      ).pipe(
        // kilocode_change - a refusal ends this effect, so the audit has to be closed on the way out.
        // The record written before the prompt was published says `ask_pending`, and leaving it there
        // reports a call that will never run again as one still waiting for a human.
        Effect.tapError(() =>
          security && audit
            ? audit(
                SecurityDecisionAdapter.finalize(
                  security.audit,
                  entry.rejection?.interactive ? "reject" : "blocked",
                  entry.rejection?.interactive ? "manual" : "auto",
                ),
              ).pipe(Effect.catchCause(() => Effect.void))
            : Effect.void,
        ),
      )
      // kilocode_change - the audit names the same answerer the approval marker does
      const answered = entry.approval?.interactive === true
      return {
        manual: true,
        interactive: answered,
        ...(security
          ? { security: SecurityDecisionAdapter.finalize(security.audit, "allow", answered ? "manual" : "auto") }
          : {}),
      } // the user was prompted and replied
      // kilocode_change end
    })

    const reply = Effect.fn("Permission.reply")(function* (input: PermissionV1.ReplyInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const existing = pending.get(input.requestID)
      if (!existing) return yield* new PermissionV1.NotFoundError({ requestID: input.requestID })

      // kilocode_change start - skill-shell batches must be answered by a human; ignore machine approvals
      // (auto-approve/YOLO clients omit `interactive`) so the prompt stays pending for a real decision.
      // Log rather than fail silently: a genuine human client sets `interactive`, so a refused reply here
      // means an auto-approver tried to answer — the request intentionally stays pending for a human.
      if (
        PermissionHumanOnly.requires(existing.info.metadata) && // kilocode_change - one predicate, shared with the clients
        input.reply !== "reject" &&
        input.interactive !== true
      ) {
        yield* Effect.logWarning("sensitive permission approval refused: requires an interactive human reply", {
          id: input.requestID,
        })
        return
      }
      // kilocode_change end

      pending.delete(input.requestID)
      yield* events.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
      })

      if (input.reply === "reject") {
        existing.rejection = { interactive: input.interactive === true } // kilocode_change - answered, not torn down
        yield* Deferred.fail(
          existing.deferred,
          input.message
            ? new PermissionV1.CorrectedError({ feedback: input.message })
            : new PermissionV1.RejectedError(),
        )

        for (const [id, item] of pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          item.rejection = { interactive: false } // kilocode_change - cascaded, so no human saw this one
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

      existing.approval = { interactive: input.interactive === true } // kilocode_change
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
  const reads = ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]
  return new Set(
    tools.filter((tool) => {
      const permission = edits.includes(tool) ? "edit" : reads.includes(tool) ? "read" : tool
      const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
      return rule?.pattern === "*" && rule.action === "deny"
    }),
  )
}

export const defaultLayer: Layer.Layer<Service> = Layer.suspend(() => AppNodeBuilder.build(node)) // kilocode_change - build from the LayerNode graph

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

export function visibleTools<T>(tools: Record<string, T>, ruleset: PermissionV1.Ruleset): Record<string, T> {
  const hidden = disabled(Object.keys(tools), ruleset)
  return Object.fromEntries(Object.entries(tools).filter(([name]) => !hidden.has(name)))
}

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [EventV2Bridge.node, Config.node, Database.node], // kilocode_change
})

export * as Permission from "."
