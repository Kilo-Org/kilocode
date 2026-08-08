// kilocode_change - new file
import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { Skill } from "../../src/skill"
import { allowed } from "../../src/kilocode/skill/allow-list"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { SessionID, MessageID } from "../../src/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { provideTmpdirInstance, TestInstance } from "../fixture/fixture"
import { InstanceStore } from "@/project/instance-store"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Agent.defaultLayer, Skill.defaultLayer, CrossSpawnSpawner.defaultLayer))
const toolIt = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, Agent.defaultLayer, CrossSpawnSpawner.defaultLayer).pipe(Layer.provide(Ripgrep.defaultLayer)))

function agent(skills?: string[], rules?: PermissionV1.Rule[]) {
  return {
    name: "code",
    mode: "primary" as const,
    permission: rules ?? [],
    options: {},
    ...(skills ? { skills } : {}),
  }
}

function toolCtx(name: string): Tool.Context {
  return {
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("msg_test"),
    callID: "",
    agent: name,
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

function writeSkill(dir: string, name: string) {
  return Bun.write(
    path.join(dir, ".kilo", "skill", name, "SKILL.md"),
    `---
name: ${name}
description: ${name} description.
---

# ${name}

Body of ${name}.
`,
  )
}

const USER_SKILLS = ["skill-a", "skill-b", "excluded-1", "frontend-design"]

function userSkills(dir: string) {
  return Effect.all(USER_SKILLS.map((name) => Effect.promise(() => writeSkill(dir, name))))
}

test("allowed returns true when allow-list is unset or empty", () => {
  expect(allowed(agent(), "skill-a")).toBe(true)
  expect(allowed(agent([]), "skill-a")).toBe(true)
})

test("allowed rejects everything with a negation-only list", () => {
  expect(allowed(agent(["!skill-a"]), "skill-a")).toBe(false)
  expect(allowed(agent(["!skill-a"]), "skill-b")).toBe(false)
})

test("allowed last matching pattern wins", () => {
  expect(allowed(agent(["!x", "*"]), "x")).toBe(true)
  expect(allowed(agent(["*", "!x"]), "x")).toBe(false)
})

test("allowed rejects skills matching no pattern", () => {
  expect(allowed(agent(["nomatch-*"]), "skill-a")).toBe(false)
})

test("allowed matching is case-sensitive", () => {
  expect(allowed(agent(["skill-a"]), "SKILL-A")).toBe(false)
  expect(allowed(agent(["SKILL-*"]), "skill-a")).toBe(false)
})

it.instance("all skills visible when agent has no skills allow-list", () =>
  Effect.gen(function* () {
    const dir = (yield* TestInstance).directory
    yield* userSkills(dir)

    const skill = yield* Skill.Service
    const list = yield* skill.available(agent())
    expect(list.map((item) => item.name).toSorted()).toEqual(expect.arrayContaining(USER_SKILLS.toSorted()))
  }),
  { git: true },
)

it.instance("only matching skills visible with allow-list", () =>
  Effect.gen(function* () {
    const dir = (yield* TestInstance).directory
    yield* userSkills(dir)

    const skill = yield* Skill.Service
    const list = yield* skill.available(agent(["skill-*"]))
    expect(list.map((item) => item.name).toSorted()).toEqual(["skill-a", "skill-b"])
  }),
  { git: true },
)

it.instance("glob negation excludes matching skills", () =>
  Effect.gen(function* () {
    const dir = (yield* TestInstance).directory
    yield* userSkills(dir)

    const skill = yield* Skill.Service
    const list = yield* skill.available(agent(["*", "!excluded-1"]))
    const names = list.map((item) => item.name).toSorted()
    expect(names).toEqual(expect.arrayContaining(USER_SKILLS.filter((name) => name !== "excluded-1").toSorted()))
    expect(names).not.toContain("excluded-1")
  }),
  { git: true },
)

it.instance("config agent skills propagate to Agent.Info", () =>
  Effect.gen(function* () {
    const svc = yield* Agent.Service
    const item = yield* svc.get("guide")
    expect(item.skills).toEqual(["skill-a"])
    expect(item.options.skills).toBeUndefined()
  }),
  { git: true, config: { agent: { guide: { description: "Guide agent", skills: ["skill-a"] } } } },
)

it.live("agent markdown frontmatter skills load", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          Bun.write(
            path.join(dir, ".kilo", "agent", "guide.md"),
            `---
description: Guide agent
skills:
  - skill-a
---

You are a guide.
`,
          ),
        )
        const store = yield* InstanceStore.Service
        yield* store.reload({ directory: dir })

        const svc = yield* Agent.Service
        const item = yield* svc.get("guide")
        expect(item.skills).toEqual(["skill-a"])
        expect(item.options.skills).toBeUndefined()
      }),
    { git: true },
  ),
)

toolIt.instance("skill tool rejects skills outside the agent allow-list", () =>
  Effect.gen(function* () {
    const dir = (yield* TestInstance).directory
    yield* userSkills(dir)

    const registry = yield* ToolRegistry.Service
    const tool = (yield* registry.tools({
      providerID: ProviderV2.ID.make("opencode"),
      modelID: ModelV2.ID.make("gpt-5"),
      agent: agent(["skill-a"]),
    })).find((item) => item.id === SkillTool.id)
    if (!tool) throw new Error("Skill tool not found")

    const ctx = toolCtx("code")

    const allowed = yield* tool.execute({ name: "skill-a" }, ctx)
    expect(allowed.output).toContain(`<skill_content name="skill-a">`)

    const denied = yield* tool.execute({ name: "skill-b" }, ctx).pipe(Effect.exit)
    expect(Exit.isFailure(denied)).toBe(true)
    if (Exit.isFailure(denied)) {
      const error = Cause.squash(denied.cause)
      expect(error).toBeInstanceOf(Error)
      if (error instanceof Error) expect(error.message).toContain('Skill "skill-b" is not allowed')
    }
  }),
  { git: true, config: { agent: { code: { skills: ["skill-a"] } } } },
)

toolIt.instance("skill tool honors last-matching-pattern negation", () =>
  Effect.gen(function* () {
    const dir = (yield* TestInstance).directory
    yield* userSkills(dir)

    const registry = yield* ToolRegistry.Service
    const tool = (yield* registry.tools({
      providerID: ProviderV2.ID.make("opencode"),
      modelID: ModelV2.ID.make("gpt-5"),
      agent: agent(["skill-*", "!skill-b"]),
    })).find((item) => item.id === SkillTool.id)
    if (!tool) throw new Error("Skill tool not found")

    const ctx = toolCtx("code")

    const allowed = yield* tool.execute({ name: "skill-a" }, ctx)
    expect(allowed.output).toContain(`<skill_content name="skill-a">`)

    const denied = yield* tool.execute({ name: "skill-b" }, ctx).pipe(Effect.exit)
    expect(Exit.isFailure(denied)).toBe(true)
    if (Exit.isFailure(denied)) {
      const error = Cause.squash(denied.cause)
      expect(error).toBeInstanceOf(Error)
      if (error instanceof Error) expect(error.message).toContain('Skill "skill-b" is not allowed')
    }
  }),
  { git: true, config: { agent: { code: { skills: ["skill-*", "!skill-b"] } } } },
)

toolIt.instance("skill tool allows every skill with an empty allow-list", () =>
  Effect.gen(function* () {
    const dir = (yield* TestInstance).directory
    yield* userSkills(dir)

    const registry = yield* ToolRegistry.Service
    const tool = (yield* registry.tools({
      providerID: ProviderV2.ID.make("opencode"),
      modelID: ModelV2.ID.make("gpt-5"),
      agent: agent([]),
    })).find((item) => item.id === SkillTool.id)
    if (!tool) throw new Error("Skill tool not found")

    const ctx = toolCtx("code")

    for (const name of ["skill-a", "skill-b"]) {
      const result = yield* tool.execute({ name }, ctx)
      expect(result.output).toContain(`<skill_content name="${name}">`)
    }
  }),
  { git: true, config: { agent: { code: { skills: [] } } } },
)

toolIt.instance("renamed agents keep the skill tool; allow-list applies to the resolved agent", () =>
  Effect.gen(function* () {
    const dir = (yield* TestInstance).directory
    yield* userSkills(dir)

    const svc = yield* Agent.Service
    const renamed = yield* svc.get("reviewer")
    expect(renamed.name).toBe("docs")
    expect(renamed.skills).toEqual(["skill-a"])

    const registry = yield* ToolRegistry.Service
    const tool = (yield* registry.tools({
      providerID: ProviderV2.ID.make("opencode"),
      modelID: ModelV2.ID.make("gpt-5"),
      agent: renamed,
    })).find((item) => item.id === SkillTool.id)
    if (!tool) throw new Error("Skill tool not found")

    const ctx = toolCtx("docs")

    const allowed = yield* tool.execute({ name: "skill-a" }, ctx)
    expect(allowed.output).toContain(`<skill_content name="skill-a">`)

    const denied = yield* tool.execute({ name: "skill-b" }, ctx).pipe(Effect.exit)
    expect(Exit.isFailure(denied)).toBe(true)
    if (Exit.isFailure(denied)) {
      const error = Cause.squash(denied.cause)
      expect(error).toBeInstanceOf(Error)
      if (error instanceof Error) expect(error.message).toContain('Skill "skill-b" is not allowed')
    }
  }),
  { git: true, config: { agent: { reviewer: { name: "docs", skills: ["skill-a"] } } } },
)

toolIt.instance("renamed agents without skills keep every skill", () =>
  Effect.gen(function* () {
    const dir = (yield* TestInstance).directory
    yield* userSkills(dir)

    const svc = yield* Agent.Service
    const renamed = yield* svc.get("reviewer")
    expect(renamed.name).toBe("docs")
    expect(renamed.skills).toBeUndefined()

    const registry = yield* ToolRegistry.Service
    const tool = (yield* registry.tools({
      providerID: ProviderV2.ID.make("opencode"),
      modelID: ModelV2.ID.make("gpt-5"),
      agent: renamed,
    })).find((item) => item.id === SkillTool.id)
    if (!tool) throw new Error("Skill tool not found")

    for (const name of ["skill-a", "skill-b"]) {
      const result = yield* tool.execute({ name }, toolCtx("docs"))
      expect(result.output).toContain(`<skill_content name="${name}">`)
    }
  }),
  { git: true, config: { agent: { reviewer: { name: "docs" } } } },
)

toolIt.instance("skill tool malformed args surface InvalidArgumentsError, not a TypeError defect", () =>
  Effect.gen(function* () {
    const dir = (yield* TestInstance).directory
    yield* userSkills(dir)

    const registry = yield* ToolRegistry.Service
    const tool = (yield* registry.tools({
      providerID: ProviderV2.ID.make("opencode"),
      modelID: ModelV2.ID.make("gpt-5"),
      agent: agent(["skill-a"]),
    })).find((item) => item.id === SkillTool.id)
    if (!tool) throw new Error("Skill tool not found")

    for (const args of [{}, { name: 123 }, null]) {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      const exit = yield* tool.execute(args as never, toolCtx("code")).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const die = exit.cause.reasons.find(Cause.isDieReason)
        const error = die?.defect
        expect(error).toBeInstanceOf(Tool.InvalidArgumentsError)
        expect(error).not.toBeInstanceOf(TypeError)
      }
    }
  }),
  { git: true, config: { agent: { code: { skills: ["skill-a"] } } } },
)

it.instance("permission.skill deny hides allow-listed skills", () =>
  Effect.gen(function* () {
    const dir = (yield* TestInstance).directory
    yield* userSkills(dir)

    const skill = yield* Skill.Service
    const list = yield* skill.available(
      agent(["skill-a", "skill-b"], [{ permission: "skill", pattern: "*", action: "deny" }]),
    )
    expect(list).toEqual([])
  }),
  { git: true },
)

it.instance("allow-list hides skills allowed by permission.skill", () =>
  Effect.gen(function* () {
    const dir = (yield* TestInstance).directory
    yield* userSkills(dir)

    const skill = yield* Skill.Service
    const list = yield* skill.available(
      agent(["skill-a"], [{ permission: "skill", pattern: "*", action: "allow" }]),
    )
    expect(list.map((item) => item.name).toSorted()).toEqual(["skill-a"])
  }),
  { git: true },
)
