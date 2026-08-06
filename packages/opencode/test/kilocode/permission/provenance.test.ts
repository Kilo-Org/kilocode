import { test, expect, describe } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../../src/agent/agent"
import { Session } from "../../../src/session/session"
import { Permission } from "../../../src/permission"
import { PermissionProvenance } from "../../../src/kilocode/permission/provenance"
import { KiloSessionPrompt } from "../../../src/kilocode/session/prompt"
import { SessionID } from "../../../src/session/schema"

describe("PermissionProvenance", () => {
  test("configSource maps the scope of a permission + pattern", () => {
    expect(PermissionProvenance.configSource("edit", "*", { edit: { "*": "global" } })).toBe("global")
    expect(PermissionProvenance.configSource("edit", "*", { edit: { "*": "local" } })).toBe("project")
    expect(PermissionProvenance.configSource("edit", "*", undefined)).toBe("agent")
    // Different patterns under one key can come from different scopes.
    const mixed = { bash: { "git status": "global" as const, "npm test": "local" as const } }
    expect(PermissionProvenance.configSource("bash", "git status", mixed)).toBe("global")
    expect(PermissionProvenance.configSource("bash", "npm test", mixed)).toBe("project")
    // A pattern not present under the key falls back to the agent default.
    expect(PermissionProvenance.configSource("bash", "rm -rf", mixed)).toBe("agent")
  })

  test("evaluate returns the winning rule object, preserving its source tag", () => {
    // The last matching rule wins; the returned object still carries the source we attached.
    const ruleset: PermissionProvenance.SourcedRule[] = [
      { permission: "edit", pattern: "*", action: "ask", source: "agent" },
      { permission: "edit", pattern: "src/*", action: "allow", source: "global" },
    ]
    const winner = Permission.evaluate("edit", "src/index.ts", ruleset)
    expect((winner as PermissionProvenance.SourcedRule).source).toBe("global")
  })

  test("classify reads a tagged rule's source and carries the agent name", () => {
    const rule = { permission: "edit", pattern: "*", action: "allow" as const, source: "agent" as const }
    expect(PermissionProvenance.classify({ rule, agent: "build", origins: undefined })).toEqual({
      source: "agent",
      agent: "build",
      rule: { permission: "edit", pattern: "*", action: "allow" },
    })
  })

  test("classify treats an untagged broad allow as yolo", () => {
    const out = PermissionProvenance.classify({
      rule: { permission: "*", pattern: "*", action: "allow" },
      agent: "build",
      origins: undefined,
    })
    expect(out.source).toBe("yolo")
  })

  test("classify falls back to config origins for an untagged rule", () => {
    const out = PermissionProvenance.classify({
      rule: { permission: "edit", pattern: "src/*", action: "allow" },
      agent: "build",
      origins: { edit: { "src/*": "local" } },
    })
    expect(out.source).toBe("project")
  })

  test("classify without a rule reports the ask fallback", () => {
    expect(PermissionProvenance.classify({ agent: "build", origins: undefined })).toEqual({ source: "default" })
  })

  test("tagAgent stamps each rule by permission + pattern, defaulting to agent", () => {
    const tagged = PermissionProvenance.tagAgent(
      [
        { permission: "bash", pattern: "git status", action: "allow" },
        { permission: "bash", pattern: "npm test", action: "allow" },
        { permission: "edit", pattern: "*", action: "allow" },
      ],
      // Global and project each contribute a different pattern under the same bash key.
      { bash: { "git status": "global", "npm test": "local" } },
    )
    expect(tagged.map((r) => r.source)).toEqual(["global", "project", "agent"])
  })

  test("tagSession marks the broad allow as yolo and other rules as session", () => {
    const tagged = PermissionProvenance.tagSession([
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "git *", action: "allow" },
    ])
    expect(tagged.map((r) => r.source)).toEqual(["yolo", "session"])
  })

  test("a tagged agent rule wins over an untagged duplicate and is not misread as yolo", () => {
    // Regression: guardPermissions re-appends agent rules for ask/plan/architect; every rule that
    // reaches evaluate must be tagged so the broad agent allow is not mistaken for YOLO mode.
    const agent = PermissionProvenance.tagAgent([{ permission: "*", pattern: "*", action: "allow" }], undefined)
    const session = PermissionProvenance.tagSession([])
    const ruleset = [...agent, ...session, ...agent] // mirrors merge(tagged, guardPermissions(...)) for a mode
    const winner = Permission.evaluate("bash", "echo hi", ruleset)
    expect(PermissionProvenance.classify({ rule: winner, agent: "plan", origins: undefined })).toEqual({
      source: "agent",
      agent: "plan",
      rule: { permission: "*", pattern: "*", action: "allow" },
    })
  })
})

describe("PermissionProvenance.carryApproval", () => {
  const approval = { source: "agent" as const, agent: "build" }

  test("carries a prior approval onto a replacement that omits it", () => {
    // The tool overwrites metadata during execution; the approval written during ask() must survive.
    expect(PermissionProvenance.carryApproval({ approval }, { command: "echo hi" })).toEqual({
      command: "echo hi",
      approval,
    })
  })

  test("does not override an approval the replacement sets itself", () => {
    const next = { approval: { source: "yolo" as const } }
    expect(PermissionProvenance.carryApproval({ approval }, next)).toBe(next)
  })

  test("leaves the replacement untouched when there is no prior approval", () => {
    const next = { command: "echo hi" }
    expect(PermissionProvenance.carryApproval({ command: "old" }, next)).toBe(next)
  })

  test("returns the replacement as-is when it is undefined", () => {
    expect(PermissionProvenance.carryApproval({ approval }, undefined)).toBeUndefined()
  })
})

describe("askPermission returns provenance", () => {
  const sessionID = SessionID.make("ses_prov")
  const agent: Agent.Info = {
    name: "build",
    mode: "primary",
    permission: Permission.fromConfig({ edit: "allow" }),
    options: {},
  }
  const session = { id: sessionID, permission: [] } as unknown as Session.Info

  const run = (outcome: Permission.AskOutcome, origins?: PermissionProvenance.Origins) =>
    Effect.gen(function* () {
      return yield* KiloSessionPrompt.askPermission({
        permission: yield* Permission.Service,
        agents: yield* Agent.Service,
        sessions: yield* Session.Service,
        origins,
        agent,
        session,
        request: { sessionID, permission: "edit", patterns: ["src/index.ts"], always: [], metadata: {} },
      })
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(Permission.Service)({ ask: () => Effect.succeed(outcome) }),
          Layer.mock(Agent.Service)({ get: () => Effect.succeed(agent) }),
          Layer.mock(Session.Service)({ get: () => Effect.succeed(session) }),
        ),
      ),
      Effect.runPromise,
    )

  test("manual reply reports the manual source", async () => {
    expect(await run({ manual: true })).toEqual({ source: "manual" })
  })

  test("agent-default rule classifies as agent with its name", async () => {
    const rule = { permission: "edit", pattern: "*", action: "allow" as const, source: "agent" as const }
    expect(await run({ manual: false, rule })).toEqual({
      source: "agent",
      agent: "build",
      rule: { permission: "edit", pattern: "*", action: "allow" },
    })
  })

  test("untagged rule falls back to config origins", async () => {
    const out = await run(
      { manual: false, rule: { permission: "edit", pattern: "src/*", action: "allow" } },
      { edit: { "src/*": "local" } },
    )
    expect(out.source).toBe("project")
  })

  test("global and project patterns under the same key are attributed independently", async () => {
    // global: bash "git status" allow; project: bash "npm test" allow -> both live under bash.
    const origins = { bash: { "git status": "global" as const, "npm test": "local" as const } }
    const fromGlobal = await run({ manual: false, rule: { permission: "bash", pattern: "git status", action: "allow" } }, origins)
    expect(fromGlobal.source).toBe("global")
    const fromProject = await run({ manual: false, rule: { permission: "bash", pattern: "npm test", action: "allow" } }, origins)
    expect(fromProject.source).toBe("project")
  })

  test("every rule passed to ask is tagged, even the guardPermissions re-append for modes", async () => {
    // Regression guard: a plan/ask/architect agent's rules are duplicated by guardPermissions.
    // Capture the ruleset askPermission builds and confirm no rule reaches evaluate untagged.
    const captured: Permission.Ruleset[] = []
    const planAgent: Agent.Info = {
      name: "plan",
      mode: "primary",
      permission: Permission.fromConfig({ bash: "allow" }),
      options: {},
    }
    const planSession = { id: sessionID, permission: [{ permission: "edit", pattern: "*", action: "deny" }] } as unknown as Session.Info
    await Effect.gen(function* () {
      yield* KiloSessionPrompt.askPermission({
        permission: yield* Permission.Service,
        agents: yield* Agent.Service,
        sessions: yield* Session.Service,
        agent: planAgent,
        session: planSession,
        request: { sessionID, permission: "bash", patterns: ["echo hi"], always: [], metadata: {} },
      })
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(Permission.Service)({
            ask: (req) =>
              Effect.sync(() => {
                captured.push(req.ruleset)
                return { manual: false } as const
              }),
          }),
          Layer.mock(Agent.Service)({ get: () => Effect.succeed(planAgent) }),
          Layer.mock(Session.Service)({ get: () => Effect.succeed(planSession) }),
        ),
      ),
      Effect.runPromise,
    )
    const ruleset = captured[0]
    expect(ruleset.length).toBeGreaterThan(0)
    expect(ruleset.every((rule) => (rule as PermissionProvenance.SourcedRule).source !== undefined)).toBe(true)
  })
})
