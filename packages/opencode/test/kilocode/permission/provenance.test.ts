import { test, expect, describe } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../../src/agent/agent"
import { Session } from "../../../src/session/session"
import { Permission } from "../../../src/permission"
import { PermissionProvenance } from "../../../src/kilocode/permission/provenance"
import { KiloSessionPrompt } from "../../../src/kilocode/session/prompt"
import { SessionID } from "../../../src/session/schema"

describe("PermissionProvenance", () => {
  test("configSource maps the scope of a permission key", () => {
    expect(PermissionProvenance.configSource("edit", { edit: "global" })).toBe("global")
    expect(PermissionProvenance.configSource("edit", { edit: "local" })).toBe("project")
    expect(PermissionProvenance.configSource("edit", undefined)).toBe("agent")
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
      origins: { edit: "local" },
    })
    expect(out.source).toBe("project")
  })

  test("classify without a rule reports the ask fallback", () => {
    expect(PermissionProvenance.classify({ agent: "build", origins: undefined })).toEqual({ source: "default" })
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
      { edit: "local" },
    )
    expect(out.source).toBe("project")
  })
})
