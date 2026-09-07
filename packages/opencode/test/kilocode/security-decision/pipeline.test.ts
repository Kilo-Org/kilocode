import { expect, afterEach } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Permission } from "@/permission"
import * as Config from "@/config/config"
import { SessionID } from "@/session/schema"
import { SecurityBlocked } from "@/kilocode/security-decision/block"
import { SecurityAsk } from "@/kilocode/security-decision/ask"
import { SecurityReviewer } from "@/kilocode/security-decision/reviewer"
import type { SecurityDecisionAdapter } from "@/kilocode/security-decision/adapter"
import { pollWithTimeout } from "../../lib/effect"
import { testEffect } from "../../lib/effect"

// The layer is authoritative but strictly monotonic: it may raise an allow to ask or block a
// proven-destructive call, and it must never weaken an existing deny, hard veto or human-only ask.

const env = Layer.mergeAll(
  AppNodeBuilder.build(Permission.node),
  AppNodeBuilder.build(Config.node),
  AppNodeBuilder.build(CrossSpawnSpawner.node),
)
const it = testEffect(env)

const previous = process.env["KILO_SECURITY_DECISION"]
afterEach(() => {
  if (previous === undefined) delete process.env["KILO_SECURITY_DECISION"]
  else process.env["KILO_SECURITY_DECISION"] = previous
  SecurityReviewer.reset()
})

const sessionID = SessionID.make("ses_security_layer")

const ask = (input: Parameters<Permission.Interface["ask"]>[0]) =>
  Effect.gen(function* () {
    return yield* (yield* Permission.Service).ask(input)
  })

const fail = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* self.pipe(Effect.exit)
    if (Exit.isFailure(exit)) return Cause.squash(exit.cause)
    throw new Error("expected the permission effect to fail")
  })

const editHook = {
  sessionID,
  permission: "edit",
  patterns: [".git/hooks/pre-commit"],
  always: ["*"],
  metadata: { filepath: ".git/hooks/pre-commit" },
}

it.instance("keeps the current outcome while the feature flag is off", () =>
  Effect.gen(function* () {
    delete process.env["KILO_SECURITY_DECISION"]
    const outcome = yield* ask({
      ...editHook,
      ruleset: [{ permission: "edit", pattern: "*", action: "allow" }],
    })
    expect(outcome.manual).toBe(false)
    expect(outcome.security).toBeUndefined()
  }),
)

it.instance("blocks a proven git-hook write with a fixed, non-echoing message", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const error = yield* fail(ask({ ...editHook, ruleset: [{ permission: "edit", pattern: "*", action: "allow" }] }))
    expect(error).toBeInstanceOf(SecurityBlocked.Error)
    const message = (error as SecurityBlocked.Error).message
    // kilocode_change - the text now also tells the model not to look for another way to the same
    // outcome. Still fixed, still naming nothing but the rule id.
    expect(message).toStartWith("Security policy blocked this tool call. rule_id=SEC.V1.GIT_HOOK_WRITE.")
    expect(message).toContain("materially safer alternative")
    expect(message).not.toContain(".git/hooks")
    expect(message).not.toContain("permission")
  }),
)

it.instance("leaves an existing explicit deny untouched", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const error = yield* fail(ask({ ...editHook, ruleset: [{ permission: "edit", pattern: "*", action: "deny" }] }))
    expect(error).toBeInstanceOf(Permission.DeniedError)
  }),
)

it.instance("leaves a hard veto untouched", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const error = yield* fail(
      ask({
        ...editHook,
        ruleset: [{ permission: "edit", pattern: "*", action: "allow" }],
        hardRuleset: [{ permission: "edit", pattern: "*", action: "deny" }],
      }),
    )
    expect(error).toBeInstanceOf(Permission.DeniedError)
  }),
)

it.instance("keeps an auto-approval when the core has no opinion, and records the audit", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const outcome = yield* ask({
      sessionID,
      permission: "edit",
      patterns: ["src/a.ts"],
      always: ["*"],
      metadata: { filepath: "src/a.ts" },
      ruleset: [{ permission: "edit", pattern: "*", action: "allow" }],
    })
    expect(outcome.manual).toBe(false)
    expect(outcome.security?.decision).toBe("pass")
    expect(outcome.security?.final_enforcement).toBe("allow")
    expect(outcome.security?.sessionID).toBe(sessionID)
  }),
)

it.instance("does not turn an opaque wildcard permission into a filesystem security ask", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const fiber = yield* ask({
      sessionID,
      permission: "todowrite",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
      ruleset: [{ permission: "todowrite", pattern: "*", action: "allow" }],
    }).pipe(Effect.forkScoped)
    yield* Effect.sleep("25 millis")
    expect(yield* permission.list()).toHaveLength(0)
    const outcome = yield* Fiber.join(fiber)
    expect(outcome.manual).toBe(false)
    expect(outcome.security?.rule_id).toBe("SEC.V1.NO_OPINION")
  }),
)

it.instance("raises an allowed grep when its metadata path is sensitive", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const fiber = yield* ask({
      sessionID,
      permission: "grep",
      patterns: ["harmless"],
      always: ["*"],
      metadata: { pattern: "harmless", path: ".env" },
      ruleset: [{ permission: "grep", pattern: "*", action: "allow" }],
    }).pipe(Effect.forkScoped)
    const request = yield* published(permission)
    expect(SecurityAsk.of(request.metadata)?.rule_id).toBe("SEC.V1.SENSITIVE_BOUNDARY")
    yield* permission.reply({ requestID: request.id, reply: "once", interactive: true })
    const outcome = yield* Fiber.join(fiber)
    expect(outcome.manual).toBe(true)
    expect(outcome.security?.rule_id).toBe("SEC.V1.SENSITIVE_BOUNDARY")
  }),
)

it.instance("raises an auto-approved CI workflow edit to a pending human ask", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const fiber = yield* ask({
      sessionID,
      permission: "edit",
      patterns: [".github/workflows/ci.yml"],
      always: ["*"],
      metadata: { filepath: ".github/workflows/ci.yml" },
      ruleset: [{ permission: "edit", pattern: "*", action: "allow" }],
    }).pipe(Effect.forkScoped)
    const pending = yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === 1) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail(new Error("timed out")) }))
    // kilocode_change - a security-raised ask needs a human reply; a machine "once" is refused
    yield* permission.reply({ requestID: pending[0]!.id, reply: "once", interactive: true })
    const outcome = yield* Fiber.join(fiber)
    expect(outcome.manual).toBe(true)
    expect(outcome.security?.rule_id).toBe("SEC.V1.CI_AUTHORITY")
    expect(outcome.security?.final_enforcement).toBe("allow")
  }),
)

const npmTest = {
  sessionID,
  permission: "bash",
  patterns: ["npm test"],
  always: ["npm *"],
  metadata: {
    command: "npm test",
    securityFacts: { complete: true, composed: false, executable: "npm", argv: ["npm", "test"], effects: [] },
  },
  ruleset: [{ permission: "bash", pattern: "*", action: "allow" as const }],
}

it.instance("keeps a contained unclassified command pending for a human", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const fiber = yield* ask({
      ...npmTest,
      containment: { sandbox: "operational", network: "deny", destinations: [], escalated: false },
    }).pipe(Effect.forkScoped)
    const pending = yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === 1) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail(new Error("timed out")) }))
    expect(SecurityAsk.of(pending[0]!.metadata)?.rule_id).toBe("SEC.V1.CONTAINED_EXEC")
    yield* permission.reply({ requestID: pending[0]!.id, reply: "once", interactive: true })
    const outcome = yield* Fiber.join(fiber)
    expect(outcome.manual).toBe(true)
    expect(outcome.security?.rule_id).toBe("SEC.V1.CONTAINED_EXEC")
    expect(outcome.security?.final_enforcement).toBe("allow")
    expect(outcome.security?.requirements).toEqual(["sandbox", "restricted_network"])
  }),
)

/**
 * The autonomy the benchmark measures has to be the autonomy the pipeline delivers.
 *
 * A reviewer can only give back what this layer itself took away: with a baseline of `allow` — auto
 * mode — a contained, benign command that the reviewer clears must reach the tool without a prompt.
 * It is never an override of the user's own policy: the companion test below starts from a baseline
 * of `ask` and the same verdict leaves the prompt standing.
 */
it.instance("returns a contained command to the auto path when the reviewer clears it", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    SecurityReviewer.bind(() => Promise.resolve('{"decision":"allow","reason_code":"ORDINARY_DEV_COMMAND"}'))
    const permission = yield* Permission.Service

    const outcome = yield* ask({
      ...npmTest,
      containment: { sandbox: "operational", network: "deny", destinations: [], escalated: false },
    })

    // No prompt was ever published, and the call carries the reviewer's verdict as its reason.
    expect(yield* permission.list()).toEqual([])
    expect(outcome.manual).toBe(false)
    expect(outcome.security?.rule_id).toBe("SEC.V1.CONTAINED_EXEC")
    expect(outcome.security?.final_enforcement).toBe("allow")
    expect(outcome.security?.reviewer).toMatchObject({ state: "allow", reason_code: "ORDINARY_DEV_COMMAND" })
  }),
)

it.instance("does not let the reviewer overrule the user's own ask policy", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    SecurityReviewer.bind(() => Promise.resolve('{"decision":"allow","reason_code":"ORDINARY_DEV_COMMAND"}'))
    const permission = yield* Permission.Service

    const fiber = yield* ask({
      ...npmTest,
      ruleset: [{ permission: "bash", pattern: "*", action: "ask" as const }],
      containment: { sandbox: "operational", network: "deny", destinations: [], escalated: false },
    }).pipe(Effect.forkScoped)

    const pending = yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === 1) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail(new Error("timed out")) }))

    yield* permission.reply({ requestID: pending[0]!.id, reply: "once", interactive: true })
    const outcome = yield* Fiber.join(fiber)
    expect(outcome.manual).toBe(true)
    expect(outcome.security?.enforcement_source).toBe("manual")
  }),
)

// The audit and the approval marker describe the same event and must agree on who answered:
// auto mode replying on the user's behalf is not the user, in either record.
it.instance("records an auto-mode reply as auto, not as a human decision", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    SecurityReviewer.bind(() => Promise.resolve('{"decision":"allow","reason_code":"ORDINARY_DEV_COMMAND"}'))
    const permission = yield* Permission.Service

    const fiber = yield* ask({
      ...npmTest,
      ruleset: [{ permission: "bash", pattern: "*", action: "ask" as const }],
      containment: { sandbox: "operational", network: "deny", destinations: [], escalated: false },
    }).pipe(Effect.forkScoped)

    const pending = yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === 1) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail(new Error("timed out")) }))

    // Exactly what auto mode sends: a reply with no `interactive` flag.
    yield* permission.reply({ requestID: pending[0]!.id, reply: "once" })
    const outcome = yield* Fiber.join(fiber)

    expect(outcome.security?.final_enforcement).toBe("allow")
    expect(outcome.security?.enforcement_source).toBe("auto")
  }),
)

it.instance("still raises a security-marked ask for the same command without proven confinement", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const fiber = yield* ask({
      ...npmTest,
      containment: { sandbox: "unknown", network: "allow", destinations: [], escalated: false },
    }).pipe(Effect.forkScoped)
    const pending = yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === 1) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail(new Error("timed out")) }))
    expect(SecurityAsk.of(pending[0]!.metadata)?.rule_id).toBe("SEC.V1.UNCLASSIFIED_EXEC")
    yield* permission.reply({ requestID: pending[0]!.id, reply: "once", interactive: true })
    yield* Fiber.join(fiber)
  }),
)

it.instance("records the live containment facts the caller supplied", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const outcome = yield* ask({
      sessionID,
      permission: "edit",
      patterns: ["src/a.ts"],
      always: ["*"],
      metadata: { filepath: "src/a.ts" },
      ruleset: [{ permission: "edit", pattern: "*", action: "allow" }],
      containment: { sandbox: "off", network: "deny", destinations: ["models.dev:443"], escalated: false },
    })
    expect(outcome.security?.containment).toEqual({
      sandbox: "off",
      network: "deny",
      destinations: ["models.dev:443"],
      escalated: false,
    })
  }),
)

it.instance("does not leak the containment facts into the pending request payload", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const fiber = yield* ask({
      sessionID,
      permission: "edit",
      patterns: [".github/workflows/ci.yml"],
      always: ["*"],
      metadata: { filepath: ".github/workflows/ci.yml" },
      ruleset: [{ permission: "edit", pattern: "*", action: "allow" }],
      containment: { sandbox: "off", network: "deny", destinations: [], escalated: false },
    }).pipe(Effect.forkScoped)
    const pending = yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === 1) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail(new Error("timed out")) }))
    expect(JSON.stringify(pending[0])).not.toContain("containment")
    yield* permission.reply({ requestID: pending[0]!.id, reply: "once", interactive: true }) // kilocode_change
    yield* Fiber.join(fiber)
  }),
)

it.instance("writes the initial audit record before the ask is published, so a reject is still audited", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const records: Array<{ final_enforcement?: string; rule_id: string }> = []
    const fiber = yield* ask({
      sessionID,
      permission: "edit",
      patterns: [".github/workflows/ci.yml"],
      always: ["*"],
      metadata: { filepath: ".github/workflows/ci.yml" },
      ruleset: [{ permission: "edit", pattern: "*", action: "allow" }],
      audit: (record) => Effect.sync(() => void records.push(record)),
    }).pipe(Effect.forkScoped)
    const pending = yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === 1) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail(new Error("timed out")) }))
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ rule_id: "SEC.V1.CI_AUTHORITY", final_enforcement: "ask_pending" })
    yield* permission.reply({ requestID: pending[0]!.id, reply: "reject" })
    const exit = yield* Fiber.await(fiber)
    expect(Exit.isFailure(exit)).toBe(true)
  }),
)

// kilocode_change start - enforcement semantics: a security deny/reject stops the call, not the turn

const ciEdit = {
  sessionID,
  permission: "edit",
  patterns: [".github/workflows/ci.yml"],
  always: ["*"],
  metadata: { filepath: ".github/workflows/ci.yml" },
  ruleset: [{ permission: "edit", pattern: "*", action: "allow" as const }],
}

const ordinaryAsk = {
  sessionID,
  permission: "edit",
  patterns: ["src/a.ts"],
  always: ["*"],
  metadata: { filepath: "src/a.ts" },
  ruleset: [{ permission: "edit", pattern: "*", action: "ask" as const }],
}

const published = (permission: Permission.Interface) =>
  Effect.gen(function* () {
    while (true) {
      const list = yield* permission.list()
      if (list.length === 1) return list[0]!
      yield* Effect.sleep("10 millis")
    }
  }).pipe(Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail(new Error("timed out")) }))

/** Stands in for the tool body: it only runs when the permission effect succeeds. */
const guarded = <A, E, R>(self: Effect.Effect<A, E, R>, counter: { runs: number }) =>
  self.pipe(Effect.tap(() => Effect.sync(() => void counter.runs++)))

it.instance("a security deny leaves no side effect and reports the rule id", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const counter = { runs: 0 }
    const records: SecurityDecisionAdapter.Audit[] = []
    const error = yield* fail(
      guarded(
        ask({
          ...editHook,
          ruleset: [{ permission: "edit", pattern: "*", action: "allow" }],
          audit: (record) => Effect.sync(() => void records.push(record)),
        }),
        counter,
      ),
    )
    expect(counter.runs).toBe(0)
    expect(error).toBeInstanceOf(SecurityBlocked.Error)
    expect((error as SecurityBlocked.Error).rule_id).toBe("SEC.V1.GIT_HOOK_WRITE")
    expect((error as SecurityBlocked.Error).audit.final_enforcement).toBe("deny")
    expect(records.at(-1)?.final_enforcement).toBe("deny")
  }),
)

it.instance("a different tool call still runs after a security deny", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const counter = { runs: 0 }
    yield* fail(
      guarded(ask({ ...editHook, ruleset: [{ permission: "edit", pattern: "*", action: "allow" }] }), counter),
    )
    const outcome = yield* guarded(
      ask({
        sessionID,
        permission: "edit",
        patterns: ["src/a.ts"],
        always: ["*"],
        metadata: { filepath: "src/a.ts" },
        ruleset: [{ permission: "edit", pattern: "*", action: "allow" }],
      }),
      counter,
    )
    expect(counter.runs).toBe(1)
    expect(outcome.manual).toBe(false)
  }),
)

it.instance("marks a security-raised ask with the typed provenance marker", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const fiber = yield* ask(ciEdit).pipe(Effect.forkScoped)
    const request = yield* published(permission)
    expect(SecurityAsk.is(request.metadata)).toBe(true)
    expect(SecurityAsk.of(request.metadata)?.rule_id).toBe("SEC.V1.CI_AUTHORITY")
    yield* permission.reply({ requestID: request.id, reply: "reject", interactive: true })
    yield* Fiber.await(fiber)
  }),
)

it.instance("leaves an ordinary ask unmarked", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const fiber = yield* ask(ordinaryAsk).pipe(Effect.forkScoped)
    const request = yield* published(permission)
    expect(SecurityAsk.is(request.metadata)).toBe(false)
    yield* permission.reply({ requestID: request.id, reply: "reject", interactive: true })
    yield* Fiber.await(fiber)
  }),
)

it.instance("a rejected security ask blocks the call and audits the reject", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const counter = { runs: 0 }
    const records: SecurityDecisionAdapter.Audit[] = []
    const fiber = yield* guarded(
      ask({ ...ciEdit, audit: (record) => Effect.sync(() => void records.push(record)) }),
      counter,
    ).pipe(Effect.forkScoped)
    const request = yield* published(permission)
    yield* permission.reply({ requestID: request.id, reply: "reject", interactive: true })
    const exit = yield* Fiber.await(fiber)
    expect(Exit.isFailure(exit)).toBe(true)
    const error = Cause.squash((exit as Exit.Failure<never, unknown>).cause)
    expect(error).toBeInstanceOf(SecurityBlocked.Error)
    expect((error as SecurityBlocked.Error).audit.final_enforcement).toBe("reject")
    expect(counter.runs).toBe(0)
    expect(records.at(-1)?.final_enforcement).toBe("reject")
  }),
)

it.instance("an approved security ask runs the call exactly once", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const counter = { runs: 0 }
    const fiber = yield* guarded(ask(ciEdit), counter).pipe(Effect.forkScoped)
    const request = yield* published(permission)
    yield* permission.reply({ requestID: request.id, reply: "once", interactive: true })
    const outcome = yield* Fiber.join(fiber)
    expect(outcome.manual).toBe(true)
    expect(outcome.security?.final_enforcement).toBe("allow")
    expect(counter.runs).toBe(1)
  }),
)

it.instance("a machine reply cannot auto-approve a security ask, and its block is audited", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const counter = { runs: 0 }
    const fiber = yield* guarded(ask(ciEdit), counter).pipe(Effect.forkScoped)
    const request = yield* published(permission)
    yield* permission.reply({ requestID: request.id, reply: "once" })
    expect(yield* permission.list()).toHaveLength(1)
    expect(counter.runs).toBe(0)
    yield* permission.reply({ requestID: request.id, reply: "reject" })
    const exit = yield* Fiber.await(fiber)
    const error = Cause.squash((exit as Exit.Failure<never, unknown>).cause)
    expect(error).toBeInstanceOf(SecurityBlocked.Error)
    expect((error as SecurityBlocked.Error).audit.final_enforcement).toBe("blocked")
    expect(counter.runs).toBe(0)
  }),
)

it.instance("an ordinary ask keeps its auto-approval and its rejection semantics", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const approved = yield* ask(ordinaryAsk).pipe(Effect.forkScoped)
    const first = yield* published(permission)
    yield* permission.reply({ requestID: first.id, reply: "once" })
    expect((yield* Fiber.join(approved)).manual).toBe(true)

    const rejected = yield* ask({ ...ordinaryAsk, patterns: ["src/b.ts"] }).pipe(Effect.forkScoped)
    const second = yield* published(permission)
    yield* permission.reply({ requestID: second.id, reply: "reject", interactive: true })
    const exit = yield* Fiber.await(rejected)
    expect(Cause.squash((exit as Exit.Failure<never, unknown>).cause)).toBeInstanceOf(Permission.RejectedError)
  }),
)
it.instance("auto-approve mode cannot resolve a pending security ask", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const counter = { runs: 0 }
    const fiber = yield* guarded(ask(ciEdit), counter).pipe(Effect.forkScoped)
    const request = yield* published(permission)
    yield* permission.allowEverything({ enable: true, sessionID, requestID: request.id })
    expect(yield* permission.list()).toHaveLength(1)
    expect(counter.runs).toBe(0)
    yield* permission.reply({ requestID: request.id, reply: "reject", interactive: true })
    yield* Fiber.await(fiber)
  }),
)

it.instance("an always-rule from a sibling ask cannot drain a pending security ask", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const counter = { runs: 0 }
    const secured = yield* guarded(ask(ciEdit), counter).pipe(Effect.forkScoped)
    const first = yield* published(permission)
    const sibling = yield* ask(ordinaryAsk).pipe(Effect.forkScoped)
    const both = yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === 2) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail(new Error("timed out")) }))
    const second = both.find((item) => item.id !== first.id)!
    yield* permission.reply({ requestID: second.id, reply: "always", interactive: true })
    yield* Fiber.join(sibling)
    expect(yield* permission.list()).toHaveLength(1)
    expect(counter.runs).toBe(0)
    yield* permission.reply({ requestID: first.id, reply: "reject", interactive: true })
    yield* Fiber.await(secured)
  }),
)
// A baseline ask the security core independently also raises is still a security decision: the
// marker is provenance, not "who raised the prompt", so no automated client may approve it.
it.instance("marks a security ask that a baseline ask already required", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const counter = { runs: 0 }
    const fiber = yield* guarded(
      ask({ ...ciEdit, ruleset: [{ permission: "edit", pattern: "*", action: "ask" }] }),
      counter,
    ).pipe(Effect.forkScoped)
    const request = yield* published(permission)
    expect(SecurityAsk.of(request.metadata)?.rule_id).toBe("SEC.V1.CI_AUTHORITY")
    expect(SecurityAsk.autoDecision({ interactive: false, metadata: request.metadata })).toBe("block")
    yield* permission.reply({ requestID: request.id, reply: "once" })
    expect(yield* permission.list()).toHaveLength(1)
    expect(counter.runs).toBe(0)
    yield* permission.reply({ requestID: request.id, reply: "reject", interactive: true })
    const exit = yield* Fiber.await(fiber)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(counter.runs).toBe(0)
  }),
)

it.instance("keeps ordinary reject semantics for a security ask a baseline ask already required", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const fiber = yield* ask({ ...ciEdit, ruleset: [{ permission: "edit", pattern: "*", action: "ask" }] }).pipe(
      Effect.forkScoped,
    )
    const request = yield* published(permission)
    yield* permission.reply({ requestID: request.id, reply: "reject", interactive: true })
    const exit = yield* Fiber.await(fiber)
    expect(Cause.squash((exit as Exit.Failure<never, unknown>).cause)).toBeInstanceOf(Permission.RejectedError)
  }),
)
// kilocode_change end

/**
 * A refusal has to close the audit too.
 *
 * An ask the ordinary pipeline raised fails its effect when it is refused, and the security record
 * written before the prompt was published is the last one anyone sees. Left at `ask_pending` it
 * reads, forever, as a call still waiting for a human — on a call that will never run again.
 */
it.instance("closes the audit when an ordinary ask is refused by a human", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const records: SecurityDecisionAdapter.Audit[] = []

    const fiber = yield* ask({
      ...npmTest,
      ruleset: [{ permission: "bash", pattern: "*", action: "ask" as const }],
      containment: { sandbox: "operational", network: "deny", destinations: [], escalated: false },
      audit: (record) => Effect.sync(() => void records.push(record)),
    }).pipe(Effect.exit, Effect.forkScoped)

    const pending = yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === 1) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail(new Error("timed out")) }))

    yield* permission.reply({ requestID: pending[0]!.id, reply: "reject", interactive: true })
    yield* Fiber.join(fiber)

    const last = records[records.length - 1]
    expect(last?.final_enforcement).toBe("reject")
    expect(last?.enforcement_source).toBe("manual")
  }),
)

it.instance("records a refusal nobody saw as blocked, not as a human refusal", () =>
  Effect.gen(function* () {
    process.env["KILO_SECURITY_DECISION"] = "1"
    const permission = yield* Permission.Service
    const records: SecurityDecisionAdapter.Audit[] = []

    const fiber = yield* ask({
      ...npmTest,
      ruleset: [{ permission: "bash", pattern: "*", action: "ask" as const }],
      containment: { sandbox: "operational", network: "deny", destinations: [], escalated: false },
      audit: (record) => Effect.sync(() => void records.push(record)),
    }).pipe(Effect.exit, Effect.forkScoped)

    const pending = yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === 1) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail(new Error("timed out")) }))

    yield* permission.reply({ requestID: pending[0]!.id, reply: "reject" })
    yield* Fiber.join(fiber)

    const last = records[records.length - 1]
    expect(last?.final_enforcement).toBe("blocked")
  }),
)

for (const name of ["read", "write", "bash", "glob", "task", "alias_tool"]) {
  it.instance(`MCP provenance survives permission collision ${name}`, () => Effect.gen(function* () {
    process.env.KILO_SECURITY_DECISION = "1"
    let calls = 0
    SecurityReviewer.bind(() => { calls++; return Promise.resolve('{"decision":"allow","reason_code":"ORDINARY_DEV_COMMAND"}') })
    const records: SecurityDecisionAdapter.Audit[] = []
    const permission = yield* Permission.Service
    const fiber = yield* permission.ask({
      source: "mcp",
      sessionID, permission: name, patterns: ["*"], always: ["*"], metadata: {},
      ruleset: [{ permission: "*", pattern: "*", action: "allow" }],
      audit: (record) => Effect.sync(() => { records.push(record) }),
    }).pipe(Effect.forkChild)
    yield* pollWithTimeout(Effect.sync(() => records.length ? true : undefined), "missing decision audit")
    const pending = yield* permission.list()
    expect(records.at(-1)?.rule_id).toBe("SEC.V1.DELEGATED_OPAQUE")
    expect(records.at(-1)?.decision).toBe("ask")
    expect(calls).toBe(0)
    expect(pending.length).toBe(1)
    yield* Fiber.interrupt(fiber)
  }))
}
