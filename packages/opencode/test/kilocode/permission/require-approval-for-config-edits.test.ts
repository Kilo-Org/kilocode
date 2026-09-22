import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer, Schema } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Bus } from "../../../src/bus"
import { ConfigProtection } from "../../../src/kilocode/permission/config-paths"
import { Permission } from "../../../src/permission"
import { SessionID } from "../../../src/session/schema"
import { disposeAllInstances, provideTmpdirInstance } from "../../fixture/fixture"
import { pollWithTimeout, testEffect } from "../../lib/effect"

const env = Layer.mergeAll(
  AppNodeBuilder.build(Permission.node),
  Bus.layer,
  AppNodeBuilder.build(CrossSpawnSpawner.node),
)
const it = testEffect(env)

const target = ".kilo/kilo.json"
const globalFile = () => path.join(Global.Path.config, "kilo.json")
const globalFiles = () => [globalFile(), path.join(Global.Path.config, "kilo.jsonc")]

async function setGlobal(value: object | undefined) {
  await fs.mkdir(Global.Path.config, { recursive: true })
  for (const file of globalFiles()) await fs.rm(file, { force: true })
  if (value !== undefined) await fs.writeFile(globalFile(), JSON.stringify(value, null, 2))
}

const withGlobal = (value: object | undefined) => Effect.promise(() => setGlobal(value))

const GlobalConfig = Schema.Record(Schema.String, Schema.Unknown)

async function text() {
  for (const file of globalFiles()) {
    const raw = await fs.readFile(file, "utf8").catch(() => undefined)
    if (raw !== undefined) return raw
  }
  return ""
}

async function stored() {
  const raw = await text()
  return raw ? Schema.decodeUnknownSync(GlobalConfig)(JSON.parse(raw)) : {}
}

const request = (id: string, over: Partial<Permission.AskInput> = {}): Permission.AskInput => ({
  id: PermissionV1.ID.make(id),
  sessionID: SessionID.make("ses_" + id),
  permission: "edit",
  patterns: [target],
  metadata: { filepath: target },
  always: [target],
  ruleset: [{ permission: "edit", pattern: "*", action: "allow" }],
  ...over,
})

const external = (id: string, pattern: string, always: string[]): Permission.AskInput => ({
  id: PermissionV1.ID.make(id),
  sessionID: SessionID.make("ses_" + id),
  permission: "external_directory",
  patterns: [pattern],
  metadata: {},
  always,
  ruleset: [],
})

const ask = (input: Permission.AskInput) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask(input)
  })

const list = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.list()
  })

const reply = (input: Permission.ReplyInput) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.reply(input)
  })

const saveAlwaysRules = (input: Parameters<Permission.Interface["saveAlwaysRules"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.saveAlwaysRules(input)
  })

const allowEverything = (input: Parameters<Permission.Interface["allowEverything"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.allowEverything(input)
  })

const reject = (id: string) => reply({ requestID: PermissionV1.ID.make(id), reply: "reject" })

const wait = (count: number) =>
  pollWithTimeout(
    list().pipe(Effect.map((items) => (items.length === count ? items : undefined))),
    `timed out waiting for ${count} pending permission request(s)`,
    "4 seconds",
  )

afterEach(async () => {
  await setGlobal(undefined)
  await disposeAllInstances()
})

describe("require_approval_for_config_edits", () => {
  it.live("defaults on and prompts for config edits even when a rule allows them", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const fiber = yield* ask(request("per_default")).pipe(Effect.forkScoped)
          const items = yield* wait(1)
          expect(items[0]).toMatchObject({ metadata: { disableAlways: true, configProtected: true } })
          yield* reject("per_default")
          expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true)
        }),
      { git: true },
    ),
  )

  it.live("an explicit global false lets an allow rule auto-approve config edits", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal({ require_approval_for_config_edits: false })
          const outcome = yield* ask(request("per_global_off"))
          expect(outcome.manual).toBe(false)
          expect(yield* list()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("project false disables protection for the project's own config files", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const outcome = yield* ask(request("per_project_false"))
          expect(outcome.manual).toBe(false)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("project false overrides a global true for the project's own config files", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal({ require_approval_for_config_edits: true })
          const outcome = yield* ask(request("per_project_over_global"))
          expect(outcome.manual).toBe(false)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("project true re-enables protection when the global value is false", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal({ require_approval_for_config_edits: false })
          const fiber = yield* ask(request("per_project_on")).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_project_on")
          yield* Fiber.await(fiber)
        }),
      { git: true, config: { require_approval_for_config_edits: true } },
    ),
  )

  it.live("project false keeps protection for global config targets", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const file = path.join(Global.Path.config, "agent", "demo.md")
          const fiber = yield* ask(
            request("per_project_global", { patterns: [file], metadata: { filepath: file }, always: [file] }),
          ).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_project_global")
          yield* Fiber.await(fiber)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("auto-approve keeps a global config edit pending when only the project disables protection", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const file = path.join(Global.Path.config, "agent", "demo.md")
          const global = yield* ask(
            request("per_yolo_global", { ruleset: [], patterns: [file], metadata: { filepath: file }, always: [file] }),
          ).pipe(Effect.forkScoped)
          const local = yield* ask(
            request("per_yolo_local", { ruleset: [], sessionID: SessionID.make("ses_per_yolo_local") }),
          ).pipe(Effect.forkScoped)
          expect(yield* wait(2)).toHaveLength(2)
          yield* allowEverything({ enable: true })
          yield* Fiber.await(local)
          const items = yield* list()
          expect(items.map((item) => item.id)).toEqual([PermissionV1.ID.make("per_yolo_global")])
          yield* reject("per_yolo_global")
          yield* Fiber.await(global)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("project false keeps protection for config files outside the project", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const file = "../sibling/.kilo/kilo.json"
          const fiber = yield* ask(
            request("per_project_sibling", { patterns: [file], metadata: { filepath: file }, always: [file] }),
          ).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_project_sibling")
          yield* Fiber.await(fiber)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("project false keeps protection for a project config symlink that escapes the project", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const outside = yield* Effect.acquireRelease(
            Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "kilo-outside-"))),
            (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
          )
          yield* Effect.promise(() => fs.symlink(outside, path.join(dir, ".kilo"), "dir"))
          yield* withGlobal(undefined)
          const fiber = yield* ask(request("per_project_symlink")).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_project_symlink")
          yield* Fiber.await(fiber)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("an explicit global false does not weaken deny rules", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal({ require_approval_for_config_edits: false })
          const exit = yield* ask(
            request("per_deny", { ruleset: [{ permission: "edit", pattern: "*", action: "deny" }] }),
          ).pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(Permission.DeniedError)
        }),
      { git: true },
    ),
  )

  it.live("an explicit global false still prompts for ordinary ask rules", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal({ require_approval_for_config_edits: false })
          const fiber = yield* ask(request("per_ask", { ruleset: [] })).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_ask")
          yield* Fiber.await(fiber)
        }),
      { git: true },
    ),
  )

  it.live("default protection downgrades an always reply without persisting", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          expect(yield* Effect.promise(text)).not.toContain('"permission"')

          const first = yield* ask(request("per_downgrade", { ruleset: [] })).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reply({ requestID: PermissionV1.ID.make("per_downgrade"), reply: "always" })
          expect(Exit.isSuccess(yield* Fiber.await(first))).toBe(true)
          expect(yield* list()).toEqual([])

          // Enabled mode must not write any permission rule to the global config file.
          expect(yield* Effect.promise(text)).not.toContain('"permission"')

          const second = yield* ask(request("per_downgrade_again", { ruleset: [] })).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_downgrade_again")
          yield* Fiber.await(second)
        }),
      { git: true },
    ),
  )

  it.live("an explicit global false persists an always reply", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal({ require_approval_for_config_edits: false })
          const first = yield* ask(request("per_persist", { ruleset: [] })).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reply({ requestID: PermissionV1.ID.make("per_persist"), reply: "always" })
          yield* Fiber.await(first)
          expect(yield* list()).toEqual([])

          // Disabled mode must persist the always rule to the global config file.
          expect(yield* Effect.promise(stored)).toMatchObject({
            require_approval_for_config_edits: false,
            permission: { edit: { [target]: "allow" } },
          })

          const outcome = yield* ask(request("per_persist_again", { ruleset: [] }))
          expect(outcome.manual).toBe(false)
        }),
      { git: true },
    ),
  )

  it.live("an explicit global false persists selected always rules", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal({ require_approval_for_config_edits: false })
          const metadata = { filepath: target, rules: [target] }
          const first = yield* ask(request("per_select", { ruleset: [], metadata })).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* saveAlwaysRules({ requestID: PermissionV1.ID.make("per_select"), approvedAlways: [target] })
          yield* reply({ requestID: PermissionV1.ID.make("per_select"), reply: "once" })
          yield* Fiber.await(first)

          expect(yield* Effect.promise(stored)).toMatchObject({
            permission: { edit: { [target]: "allow" } },
          })

          const outcome = yield* ask(request("per_select_again", { ruleset: [] }))
          expect(outcome.manual).toBe(false)
        }),
      { git: true },
    ),
  )

  it.live("default protection ignores selected always rules", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const metadata = { filepath: target, rules: [target] }
          const first = yield* ask(request("per_select_blocked", { ruleset: [], metadata })).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* saveAlwaysRules({ requestID: PermissionV1.ID.make("per_select_blocked"), approvedAlways: [target] })
          expect(yield* Effect.promise(text)).not.toContain('"permission"')
          yield* reject("per_select_blocked")
          yield* Fiber.await(first)

          const second = yield* ask(request("per_select_blocked_again", { ruleset: [] })).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_select_blocked_again")
          yield* Fiber.await(second)
        }),
      { git: true },
    ),
  )

  it.live("auto-approve does not clear a pending config edit while protection is on", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const fiber = yield* ask(request("per_yolo_blocked", { ruleset: [] })).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* allowEverything({ enable: true, requestID: PermissionV1.ID.make("per_yolo_blocked") })
          expect(yield* list()).toHaveLength(1)
          yield* reject("per_yolo_blocked")
          yield* Fiber.await(fiber)
        }),
      { git: true },
    ),
  )

  it.live("auto-approve clears a pending config edit when protection is disabled globally", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal({ require_approval_for_config_edits: false })
          const fiber = yield* ask(request("per_yolo", { ruleset: [] })).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* allowEverything({ enable: true, requestID: PermissionV1.ID.make("per_yolo") })
          yield* Fiber.await(fiber)
          expect(yield* list()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("sibling drain does not auto-resolve a config edit while protection is on", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const first = yield* ask(request("per_drain_blocked_1")).pipe(Effect.forkScoped)
          const second = yield* ask(
            request("per_drain_blocked_2", { sessionID: SessionID.make("ses_per_drain_blocked_2") }),
          ).pipe(Effect.forkScoped)
          expect(yield* wait(2)).toHaveLength(2)
          yield* reply({ requestID: PermissionV1.ID.make("per_drain_blocked_1"), reply: "always" })
          yield* Fiber.await(first)
          expect(yield* list()).toHaveLength(1)
          yield* reject("per_drain_blocked_2")
          yield* Fiber.await(second)
        }),
      { git: true },
    ),
  )

  it.live("sibling drain auto-resolves a config edit when protection is disabled globally", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal({ require_approval_for_config_edits: false })
          const first = yield* ask(request("per_drain_1", { ruleset: [] })).pipe(Effect.forkScoped)
          const second = yield* ask(
            request("per_drain_2", { sessionID: SessionID.make("ses_per_drain_2"), ruleset: [] }),
          ).pipe(Effect.forkScoped)
          expect(yield* wait(2)).toHaveLength(2)
          yield* reply({ requestID: PermissionV1.ID.make("per_drain_1"), reply: "always" })
          yield* Fiber.await(first)
          yield* Fiber.await(second)
          expect(yield* list()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("observes global config updates without a singleton cache", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const blocked = yield* ask(request("per_fresh_blocked")).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_fresh_blocked")
          yield* Fiber.await(blocked)

          yield* withGlobal({ require_approval_for_config_edits: false })
          expect((yield* ask(request("per_fresh_off"))).manual).toBe(false)

          yield* withGlobal({ require_approval_for_config_edits: true })
          const reenabled = yield* ask(request("per_fresh_on")).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_fresh_on")
          yield* Fiber.await(reenabled)
        }),
      { git: true },
    ),
  )

  it.live("keeps global skill trust for external_directory while protection is on", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const skill = path.join(Global.Path.config, "skills", "demo")
          yield* Effect.promise(() => fs.mkdir(skill, { recursive: true }))
          const raw = path.join(skill, "*").replaceAll("\\", "/")
          const pattern = ConfigProtection.globalSkillPattern({ permission: "external_directory", patterns: [raw] })
          expect(pattern).toBeDefined()
          yield* withGlobal({ permission: { external_directory: { [pattern!]: "allow" } } })

          const outcome = yield* ask({
            id: PermissionV1.ID.make("per_skill"),
            sessionID: SessionID.make("ses_per_skill"),
            permission: "external_directory",
            patterns: [pattern!],
            metadata: {},
            always: [pattern!],
            ruleset: [{ permission: "external_directory", pattern: pattern!, action: "allow" }],
          })
          expect(outcome.manual).toBe(false)
        }),
      { git: true },
    ),
  )

  it.live("drain keeps exact global-skill constraints while protection is on", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const { skill, concrete } = yield* Effect.promise(() => paths("drain-on"))
          yield* withGlobal(undefined)
          const first = yield* ask(external("per_drain_skill_on_1", concrete, [concrete])).pipe(Effect.forkScoped)
          const second = yield* ask(external("per_drain_skill_on_2", concrete, [concrete])).pipe(Effect.forkScoped)
          const items = yield* wait(2)
          expect(items.find((item) => item.id === PermissionV1.ID.make("per_drain_skill_on_2"))?.always).toEqual([
            skill,
          ])

          yield* reply({ requestID: PermissionV1.ID.make("per_drain_skill_on_2"), reply: "always" })
          yield* Fiber.await(second)
          // Enabled mode narrows persistence to the exact skill subtree, never the concrete file.
          const written = yield* Effect.promise(text)
          expect(written).toContain(skill)
          expect(written).not.toContain(concrete)

          yield* Fiber.await(first)
          expect(yield* list()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("drain resolves a global-skill request under ordinary rules when protection is disabled", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const { skill, concrete } = yield* Effect.promise(() => paths("drain-off"))
          yield* withGlobal({ require_approval_for_config_edits: false })
          const first = yield* ask(external("per_drain_skill_off_1", concrete, [concrete])).pipe(Effect.forkScoped)
          const second = yield* ask(external("per_drain_skill_off_2", concrete, [concrete])).pipe(Effect.forkScoped)
          expect(yield* wait(2)).toHaveLength(2)
          yield* reply({ requestID: PermissionV1.ID.make("per_drain_skill_off_2"), reply: "always" })
          yield* Fiber.await(first)
          yield* Fiber.await(second)
          expect(yield* list()).toEqual([])
          // Disabled mode persists the ordinary concrete pattern, not the exact skill subtree.
          const written = yield* Effect.promise(text)
          expect(written).toContain(concrete)
          expect(written).not.toContain(skill)
        }),
      { git: true },
    ),
  )

  it.live("saveAlwaysRules drain resolves a global-skill request when protection is disabled", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const { concrete } = yield* Effect.promise(() => paths("drain-save"))
          yield* withGlobal({ require_approval_for_config_edits: false })
          const first = yield* ask(external("per_drain_skill_save_1", concrete, [concrete])).pipe(Effect.forkScoped)
          const second = yield* ask(external("per_drain_skill_save_2", concrete, [concrete])).pipe(Effect.forkScoped)
          expect(yield* wait(2)).toHaveLength(2)
          yield* saveAlwaysRules({
            requestID: PermissionV1.ID.make("per_drain_skill_save_2"),
            approvedAlways: [concrete],
          })
          yield* Fiber.await(first)
          expect(yield* list()).toHaveLength(1)
          yield* reject("per_drain_skill_save_2")
          yield* Fiber.await(second)
        }),
      { git: true },
    ),
  )
})

async function paths(name: string) {
  const dir = path.join(Global.Path.config, "skills", name)
  await fs.mkdir(dir, { recursive: true })
  const raw = path.join(dir, "*").replaceAll("\\", "/")
  const skill = ConfigProtection.globalSkillPattern({ permission: "external_directory", patterns: [raw] })
  if (!skill) throw new Error(`expected a global skill pattern for ${dir}`)
  return { skill, concrete: skill.slice(0, -2) + "/SKILL.md" }
}
