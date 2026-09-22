import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { afterEach, describe, expect, spyOn } from "bun:test"
import { $ } from "bun"
import { Cause, Effect, Exit, Fiber, Layer, Schema } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Bus } from "../../../src/bus"
import { Config } from "../../../src/config/config"
import { ConfigProtection } from "../../../src/kilocode/permission/config-paths"
import { Permission } from "../../../src/permission"
import { MessageID, SessionID } from "../../../src/session/schema"
import type { Tool } from "../../../src/tool/tool"
import { assertExternalDirectoryEffect } from "../../../src/tool/external-directory"
import {
  disposeAllInstances,
  provideInstance,
  provideTmpdirInstance,
  testInstanceStoreLayer,
  tmpdirScoped,
} from "../../fixture/fixture"
import { pollWithTimeout, testEffect } from "../../lib/effect"

const env = Layer.mergeAll(
  AppNodeBuilder.build(LayerNode.group([Permission.node, Config.node])),
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

const managedDir = process.env["KILO_TEST_MANAGED_CONFIG_DIR"]!

async function setManaged(value: object | undefined) {
  const file = path.join(managedDir, "kilo.json")
  await fs.rm(file, { force: true })
  if (value === undefined) return
  await fs.mkdir(managedDir, { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2))
}

const withManaged = (value: object | undefined) => Effect.promise(() => setManaged(value))

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

// A Tool.Context that forwards external_directory prompts into the real Permission service.
const toolCtx = (permission: Permission.Interface, id: string): Tool.Context => {
  const sessionID = SessionID.make("ses_" + id)
  return {
    sessionID,
    messageID: MessageID.make("msg_" + id),
    callID: id,
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (req) =>
      permission
        .ask({ ...req, id: PermissionV1.ID.make(id), sessionID, ruleset: [] })
        .pipe(Effect.asVoid, Effect.orDie),
  }
}

// Point both the loader's home (KILO_TEST_HOME) and the classifier's home (HOME) at one directory so
// legacy global config dirs resolve consistently, and restore them even when an assertion fails.
function withHome<T, E, R>(home: string, effect: Effect.Effect<T, E, R>) {
  const prevHome = process.env["HOME"]
  const prevTestHome = process.env["KILO_TEST_HOME"]
  process.env["HOME"] = home
  process.env["KILO_TEST_HOME"] = home
  return effect.pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (prevHome === undefined) delete process.env["HOME"]
        else process.env["HOME"] = prevHome
        if (prevTestHome === undefined) delete process.env["KILO_TEST_HOME"]
        else process.env["KILO_TEST_HOME"] = prevTestHome
      }),
    ),
  )
}

async function legacyHome(files: Record<string, string | undefined>) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-legacy-home-"))
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(home, rel)
    await fs.rm(file, { force: true })
    if (body === undefined) continue
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, body)
  }
  return home
}

// Set one environment variable for the duration of an effect and restore the previous value even
// when an assertion fails. The value is applied synchronously so it is in place before the effect runs.
function withEnv<T, E, R>(name: string, value: string | undefined, effect: Effect.Effect<T, E, R>) {
  const previous = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
  return effect.pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (previous === undefined) delete process.env[name]
        else process.env[name] = previous
      }),
    ),
  )
}

function withConfigDir<T, E, R>(dir: string, effect: Effect.Effect<T, E, R>) {
  return withEnv("KILO_CONFIG_DIR", dir, effect)
}

const auto = (id: string, file: string) =>
  Effect.gen(function* () {
    const outcome = yield* ask(editRequest(id, file))
    expect(outcome.manual).toBe(false)
  })

const prompts = (id: string, file: string) =>
  Effect.gen(function* () {
    const fiber = yield* ask(editRequest(id, file)).pipe(Effect.forkScoped)
    const items = yield* wait(1)
    expect(items.some((item) => item.id === PermissionV1.ID.make(id))).toBe(true)
    yield* reject(id)
    yield* Fiber.await(fiber)
  })

afterEach(async () => {
  await setGlobal(undefined)
  await setManaged(undefined)
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
          expect(yield* list()).toEqual([])
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("global true with project false disables protection for the project's own files", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal({ require_approval_for_config_edits: true })
          const outcome = yield* ask(request("per_global_on_project_off"))
          expect(outcome.manual).toBe(false)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("global false with project true re-enables protection for the project's own files", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal({ require_approval_for_config_edits: false })
          const fiber = yield* ask(request("per_global_off_project_on")).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_global_off_project_on")
          yield* Fiber.await(fiber)
        }),
      { git: true, config: { require_approval_for_config_edits: true } },
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

  it.live("classifies each entry once per permission operation", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          // Spying on the exported classifier proves the orchestration reuses one classification per
          // entry instead of resolving targets again for the gate and each verdict. The classifier
          // itself still runs the real filesystem logic.
          const spy = spyOn(ConfigProtection, "classify")
          try {
            const first = yield* ask(request("per_class_1", { ruleset: [] })).pipe(Effect.forkScoped)
            const second = yield* ask(request("per_class_2", { ruleset: [] })).pipe(Effect.forkScoped)
            const third = yield* ask(request("per_class_3", { ruleset: [] })).pipe(Effect.forkScoped)
            expect(yield* wait(3)).toHaveLength(3)
            expect(spy.mock.calls.length).toBe(3)

            // Protection is on, so the reply entry is classified and blocks before any sibling scan.
            yield* reply({ requestID: PermissionV1.ID.make("per_class_1"), reply: "always" })
            yield* Fiber.await(first)
            expect(spy.mock.calls.length).toBe(4)

            yield* reject("per_class_2")
            yield* reject("per_class_3")
            yield* Fiber.await(second)
            yield* Fiber.await(third)
          } finally {
            spy.mockRestore()
          }
        }),
      { git: true },
    ),
  )

  it.live("classifies each entry once when saving selected always rules", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const spy = spyOn(ConfigProtection, "classify")
          try {
            const first = yield* ask(
              request("per_save_class_1", { ruleset: [], metadata: { filepath: target, rules: [target] } }),
            ).pipe(Effect.forkScoped)
            const second = yield* ask(request("per_save_class_2", { ruleset: [] })).pipe(Effect.forkScoped)
            const third = yield* ask(request("per_save_class_3", { ruleset: [] })).pipe(Effect.forkScoped)
            expect(yield* wait(3)).toHaveLength(3)
            expect(spy.mock.calls.length).toBe(3)

            // The saved request is still in the pending map; the lazy plan dedupes it and blocks
            // before classifying the unprotected siblings.
            yield* saveAlwaysRules({ requestID: PermissionV1.ID.make("per_save_class_1"), approvedAlways: [target] })
            expect(spy.mock.calls.length).toBe(4)

            yield* reject("per_save_class_1")
            yield* reject("per_save_class_2")
            yield* reject("per_save_class_3")
            yield* Fiber.await(first)
            yield* Fiber.await(second)
            yield* Fiber.await(third)
          } finally {
            spy.mockRestore()
          }
        }),
      { git: true },
    ),
  )

  it.live("reuses the reply plan for drain and reclassifies on the next operation", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal({ require_approval_for_config_edits: false })
          const spy = spyOn(ConfigProtection, "classify")
          try {
            const first = yield* ask(request("per_plan_drain_1", { ruleset: [] })).pipe(Effect.forkScoped)
            const second = yield* ask(request("per_plan_drain_2", { ruleset: [] })).pipe(Effect.forkScoped)
            const third = yield* ask(request("per_plan_drain_3", { ruleset: [] })).pipe(Effect.forkScoped)
            expect(yield* wait(3)).toHaveLength(3)
            expect(spy.mock.calls.length).toBe(3)

            // Protection is disabled for these entries, so the reply actually drains its siblings.
            yield* reply({ requestID: PermissionV1.ID.make("per_plan_drain_1"), reply: "always" })
            yield* Fiber.await(first)
            yield* Fiber.await(second)
            yield* Fiber.await(third)
            expect(yield* list()).toEqual([])
            // The gate short-circuits on the reply entry; drain then lazily classifies just the
            // siblings it reaches, so every entry is still resolved exactly once.
            expect(spy.mock.calls.length).toBe(6)

            // A later operation classifies again instead of reusing a retained plan.
            expect((yield* ask(request("per_plan_drain_4"))).manual).toBe(false)
            expect(spy.mock.calls.length).toBe(7)
          } finally {
            spy.mockRestore()
          }
        }),
      { git: true },
    ),
  )

  it.live("reuses the YOLO plan for every covered pending entry", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal({ require_approval_for_config_edits: false })
          const spy = spyOn(ConfigProtection, "classify")
          try {
            const first = yield* ask(request("per_yolo_plan_1", { ruleset: [] })).pipe(Effect.forkScoped)
            const second = yield* ask(request("per_yolo_plan_2", { ruleset: [] })).pipe(Effect.forkScoped)
            const third = yield* ask(request("per_yolo_plan_3", { ruleset: [] })).pipe(Effect.forkScoped)
            expect(yield* wait(3)).toHaveLength(3)
            expect(spy.mock.calls.length).toBe(3)

            yield* allowEverything({ enable: true, requestID: PermissionV1.ID.make("per_yolo_plan_1") })
            yield* Fiber.await(first)
            yield* Fiber.await(second)
            yield* Fiber.await(third)
            expect(yield* list()).toEqual([])
            // The gate stops at the first config-shaped entry; the covered() checks lazily classify
            // the rest, so each pending entry is still resolved exactly once.
            expect(spy.mock.calls.length).toBe(6)
          } finally {
            spy.mockRestore()
          }
        }),
      { git: true },
    ),
  )

  it.live("observes a project edit without dropping the cached global config", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const config = yield* Config.Service
          yield* withGlobal({ require_approval_for_config_edits: true })
          const project = path.join(dir, "kilo.json")
          yield* Effect.promise(() =>
            fs.writeFile(project, JSON.stringify({ require_approval_for_config_edits: true })),
          )

          // Warm the global cache, then confirm the project config is protected under the default.
          const globalBefore = yield* config.getGlobal()
          const blocked = yield* ask(request("per_cache_blocked")).pipe(Effect.forkScoped)
          expect((yield* wait(1))[0]?.metadata).toMatchObject({ configProtected: true })
          yield* reject("per_cache_blocked")
          yield* Fiber.await(blocked)

          // A direct project edit changes only project-owned sources. The next protected request must
          // reload the project config without invalidating the cached global object.
          yield* Effect.promise(() =>
            fs.writeFile(project, JSON.stringify({ require_approval_for_config_edits: false })),
          )
          expect((yield* ask(request("per_cache_off"))).manual).toBe(false)
          expect(yield* config.getGlobal()).toBe(globalBefore)

          // Global freshness still propagates after the project-only invalidation.
          yield* withGlobal({ require_approval_for_config_edits: false, username: "fresh" })
          const globalFresh = yield* config.getGlobal()
          expect(globalFresh).not.toBe(globalBefore)
          expect(globalFresh.username).toBe("fresh")
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

  it.live("KILO_CONFIG_CONTENT false only disables protection inside the project", () =>
    withEnv(
      "KILO_CONFIG_CONTENT",
      JSON.stringify({ require_approval_for_config_edits: false }),
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            yield* withGlobal(undefined)
            // The env-provided value is a non-global source: it feeds the effective project config,
            // so it can disable protection for this project's own files...
            expect((yield* ask(request("per_env_content_local"))).manual).toBe(false)

            // ...but it never changes the global policy for global config files.
            const file = globalFile()
            const fiber = yield* ask(
              request("per_env_content_global", {
                patterns: [file],
                metadata: { filepath: file },
                always: [file],
                ruleset: [],
              }),
            ).pipe(Effect.forkScoped)
            expect(yield* wait(1)).toHaveLength(1)
            yield* reject("per_env_content_global")
            yield* Fiber.await(fiber)
          }),
        { git: true },
      ),
    ),
  )

  it.live("drain keeps exact global-skill constraints while protection is on", () =>
    provideTmpdirInstance(
      () =>
        withSkill("drain-on", ({ skill, concrete }) =>
          Effect.gen(function* () {
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
        ),
      { git: true },
    ),
  )

  it.live("drain resolves a global-skill request under ordinary rules when protection is disabled", () =>
    provideTmpdirInstance(
      () =>
        withSkill("drain-off", ({ skill, concrete }) =>
          Effect.gen(function* () {
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
        ),
      { git: true },
    ),
  )

  it.live("saveAlwaysRules drain resolves a global-skill request when protection is disabled", () =>
    provideTmpdirInstance(
      () =>
        withSkill("drain-save", ({ concrete }) =>
          Effect.gen(function* () {
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
        ),
      { git: true },
    ),
  )

  // --- project boundary scoping ---

  const scoped = (id: string, file: string, over: Partial<Permission.AskInput> = {}): Permission.AskInput =>
    request(id, { patterns: [file], metadata: { filepath: file }, always: [file], ruleset: [], ...over })

  it.live("project false keeps protection for global config targets", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const file = globalFile()
          const fiber = yield* ask(scoped("per_proj_off_global", file)).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_proj_off_global")
          yield* Fiber.await(fiber)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("project false keeps protection for absolute out-of-project config targets", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const file = path.join(os.tmpdir(), "opencode-test-sibling-absolute", ".kilo", "kilo.json")
          const fiber = yield* ask(scoped("per_proj_off_sibling", file)).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_proj_off_sibling")
          yield* Fiber.await(fiber)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  // --- managed global sources feed the global policy ---

  it.live("managed global config enforces the policy over a false primary", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal({ require_approval_for_config_edits: false })
          yield* withManaged({ require_approval_for_config_edits: true })
          // Managed config is a global-scoped source: it governs the project's own config files...
          yield* prompts("per_managed_inside", target)
          // ...and the global policy for global config targets.
          yield* prompts("per_managed_global", globalFile())
        }),
      { git: true },
    ),
  )

  it.live("managed global false overrides a true primary for both scopes", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal({ require_approval_for_config_edits: true })
          yield* withManaged({ require_approval_for_config_edits: false })
          yield* auto("per_managed_off_inside", target)
          yield* auto("per_managed_off_global", globalFile())
        }),
      { git: true },
    ),
  )

  it.live("project false does not weaken managed global enforcement", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          yield* withManaged({ require_approval_for_config_edits: true })
          yield* prompts("per_managed_beats_project_inside", target)
          yield* prompts("per_managed_beats_project_global", globalFile())
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("legacy home roots govern nested global targets when home is the project", () =>
    Effect.gen(function* () {
      const prev = Global.Path.config
      const home = yield* tmpdirScoped({ git: true })
      const nested = path.join(home, "xdg", "kilo")
      ;(Global.Path as { config: string }).config = nested
      yield* withHome(
        home,
        Effect.gen(function* () {
          for (const c of [
            { id: "legacy_off", primary: true, legacy: false, check: auto },
            { id: "legacy_on", primary: false, legacy: true, check: prompts },
          ]) {
            yield* Effect.promise(async () => {
              await fs.mkdir(nested, { recursive: true })
              await fs.writeFile(
                path.join(nested, "kilo.json"),
                JSON.stringify({ require_approval_for_config_edits: c.primary }),
              )
              await fs.mkdir(path.join(home, ".kilo"), { recursive: true })
              await fs.writeFile(
                path.join(home, ".kilo", "kilo.json"),
                JSON.stringify({ require_approval_for_config_edits: c.legacy }),
              )
            })
            yield* Effect.promise(() => disposeAllInstances())
            const file = path.join(nested, "kilo.json")
            yield* provideInstance(home)(
              Effect.gen(function* () {
                const level = ConfigProtection.classify(
                  { permission: "edit", patterns: [file], metadata: { filepath: file } },
                  home,
                )
                expect(level.external).toBe(true)
                expect(level.inside).toBe(false)
                yield* c.check(`per_home_project_${c.id}`, file)
              }),
            )
          }
        }),
      ).pipe(
        Effect.provide(testInstanceStoreLayer),
        Effect.ensuring(Effect.sync(() => ((Global.Path as { config: string }).config = prev))),
      )
    }),
  )

  it.live("project false keeps protection for relative traversal into a sibling project", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const file = "../sibling-project/.kilo/kilo.json"
          const fiber = yield* ask(scoped("per_proj_off_traversal", file)).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_proj_off_traversal")
          yield* Fiber.await(fiber)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("project false cannot bypass protection through a symlinked escape", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const outside = path.join(path.dirname(dir), "opencode-test-outside-" + Math.random().toString(36).slice(2))
          yield* Effect.promise(() => fs.mkdir(outside, { recursive: true }))
          const link = path.join(dir, "escape")
          yield* Effect.promise(() => fs.symlink(outside, link, process.platform === "win32" ? "junction" : "dir"))

          const direct = path.join(link, ".kilo", "kilo.json")
          const first = yield* ask(scoped("per_proj_off_link", direct)).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_proj_off_link")
          yield* Fiber.await(first)

          // Nonexistent leaf under a symlinked parent still resolves to the physical target.
          const leaf = path.join(link, "nested", ".kilo", "kilo.json")
          const second = yield* ask(scoped("per_proj_off_link_leaf", leaf)).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_proj_off_link_leaf")
          yield* Fiber.await(second)

          yield* Effect.promise(() => fs.rm(link, { recursive: true, force: true }))
          yield* Effect.promise(() => fs.rm(outside, { recursive: true, force: true }))
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("treats a global config directory inside the project as global policy", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const link = path.join(dir, "global-link")
          yield* Effect.promise(() =>
            fs.symlink(Global.Path.config, link, process.platform === "win32" ? "junction" : "dir"),
          )

          const file = path.join(link, "kilo.json")
          const fiber = yield* ask(scoped("per_proj_off_global_link", file)).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_proj_off_global_link")
          yield* Fiber.await(fiber)

          yield* Effect.promise(() => fs.rm(link, { recursive: true, force: true }))
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("project false still protects a sibling absolute path with a shared prefix", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const file = path.join(dir + "-evil", ".kilo", "kilo.json")
          const fiber = yield* ask(scoped("per_proj_off_prefix", file)).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_proj_off_prefix")
          yield* Fiber.await(fiber)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("falls back to the directory as the boundary for non-git projects", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          // A local config edit uses the project policy...
          expect((yield* ask(request("per_non_git_local"))).manual).toBe(false)
          // ...but a path outside the directory is not treated as inside a `/` boundary.
          const file = path.join(path.dirname(dir), "opencode-test-outside-nongit", ".kilo", "kilo.json")
          const fiber = yield* ask(scoped("per_non_git_outside", file)).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_non_git_outside")
          yield* Fiber.await(fiber)
        }),
      { config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("project false allows a nested .kilo edit but not a nested AGENTS.md", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          expect((yield* ask(editRequest("per_nested_kilo", "packages/sub/.kilo/config.json"))).manual).toBe(false)
          // Nested AGENTS.md is not protected by name, so it is not newly gated by config protection.
          const outcome = yield* ask(editRequest("per_nested_agents", "src/AGENTS.md"))
          expect(outcome.manual).toBe(false)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("project false does not bypass a mixed apply_patch with an outside destination", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const outside = path.join(os.tmpdir(), "opencode-test-move-outside", ".kilo", "moved.json")
          const files = [{ filePath: path.join(dir, ".kilo", "kilo.json"), movePath: outside, type: "move" }]
          const fiber = yield* ask({
            ...request("per_mixed_move", {
              patterns: [".kilo/kilo.json"],
              metadata: { filepath: ".kilo/kilo.json", files },
              always: ["*"],
              ruleset: [],
            }),
          }).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_mixed_move")
          yield* Fiber.await(fiber)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("project false allows a local-only apply_patch move", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const inside = { filePath: ".kilo/kilo.json", movePath: ".kilo/kilo.jsonc", type: "move" }
          const outcome = yield* ask(
            request("per_mixed_local", {
              patterns: [".kilo/kilo.json"],
              metadata: { filepath: ".kilo/kilo.json", files: [inside] },
              always: ["*"],
            }),
          )
          expect(outcome.manual).toBe(false)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("project false still honors deny and ask rules", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const denied = yield* ask(
            request("per_proj_deny", { ruleset: [{ permission: "edit", pattern: "*", action: "deny" }] }),
          ).pipe(Effect.exit)
          expect(Exit.isFailure(denied)).toBe(true)
          if (Exit.isFailure(denied)) expect(Cause.squash(denied.cause)).toBeInstanceOf(Permission.DeniedError)

          const asked = yield* ask(request("per_proj_ask", { ruleset: [] })).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_proj_ask")
          yield* Fiber.await(asked)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("a project-scoped always rule does not bypass global protection", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const first = yield* ask(request("per_leak_always", { always: ["*"], ruleset: [] })).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reply({ requestID: PermissionV1.ID.make("per_leak_always"), reply: "always" })
          yield* Fiber.await(first)
          expect(yield* Effect.promise(stored)).toMatchObject({ permission: { edit: { "*": "allow" } } })

          const file = globalFile()
          const second = yield* ask(scoped("per_leak_global", file)).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* reject("per_leak_global")
          yield* Fiber.await(second)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("YOLO does not clear a protected global request while the project disables local protection", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const file = globalFile()
          const local = yield* ask(request("per_yolo_local", { ruleset: [] })).pipe(Effect.forkScoped)
          const global = yield* ask(scoped("per_yolo_global", file)).pipe(Effect.forkScoped)
          expect(yield* wait(2)).toHaveLength(2)

          yield* allowEverything({ enable: true })
          yield* Fiber.await(local)
          expect((yield* list()).map((item) => item.id)).toEqual([PermissionV1.ID.make("per_yolo_global")])
          yield* reject("per_yolo_global")
          yield* Fiber.await(global)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("project-scoped drain does not auto-resolve a protected global request", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const file = globalFile()
          const first = yield* ask(request("per_drain_local", { always: ["*"], ruleset: [] })).pipe(Effect.forkScoped)
          const second = yield* ask(scoped("per_drain_global", file)).pipe(Effect.forkScoped)
          expect(yield* wait(2)).toHaveLength(2)

          yield* reply({ requestID: PermissionV1.ID.make("per_drain_local"), reply: "always" })
          yield* Fiber.await(first)
          expect((yield* list()).map((item) => item.id)).toEqual([PermissionV1.ID.make("per_drain_global")])
          yield* reject("per_drain_global")
          yield* Fiber.await(second)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("saveAlwaysRules persists for local targets but not global targets under project false", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const local = yield* ask(request("per_save_local", { ruleset: [] })).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* saveAlwaysRules({
            requestID: PermissionV1.ID.make("per_save_local"),
            approvedAlways: [target],
          })
          expect(yield* Effect.promise(stored)).toMatchObject({ permission: { edit: { [target]: "allow" } } })
          yield* reject("per_save_local")
          yield* Fiber.await(local)

          const file = globalFile()
          const global = yield* ask(scoped("per_save_global", file)).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)
          yield* saveAlwaysRules({
            requestID: PermissionV1.ID.make("per_save_global"),
            approvedAlways: [file],
          })
          expect(yield* Effect.promise(text)).not.toContain(file)
          yield* reject("per_save_global")
          yield* Fiber.await(global)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("ordinary saveAlwaysRules drains an unprotected project-config sibling but not a global one", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const ordinary = path.join(dir, "src", "app.ts")
          const global = yield* ask(scoped("per_save_cross_global", globalFile())).pipe(Effect.forkScoped)
          const local = yield* ask(request("per_save_cross_local", { ruleset: [] })).pipe(Effect.forkScoped)
          const normal = yield* ask(scoped("per_save_cross_ordinary", ordinary, { always: ["*"] })).pipe(
            Effect.forkScoped,
          )
          expect(yield* wait(3)).toHaveLength(3)

          // The selected rule comes from an ordinary (non-config) request, but a config-shaped
          // sibling is pending, so the policy must still be resolved per entry.
          yield* saveAlwaysRules({
            requestID: PermissionV1.ID.make("per_save_cross_ordinary"),
            approvedAlways: ["*"],
          })

          const pending = new Set((yield* list()).map((item) => item.id))
          expect(pending.has(PermissionV1.ID.make("per_save_cross_local"))).toBe(false)
          expect(pending.has(PermissionV1.ID.make("per_save_cross_global"))).toBe(true)

          yield* reject("per_save_cross_global")
          yield* reject("per_save_cross_ordinary")
          yield* Fiber.await(local)
          yield* Fiber.await(global)
          yield* Fiber.await(normal)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("keeps global skill constraints for global targets when only the project disables protection", () =>
    provideTmpdirInstance(
      () =>
        withSkill("drain-project-off", ({ skill, concrete }) =>
          Effect.gen(function* () {
            yield* withGlobal(undefined)
            const first = yield* ask(external("per_skill_project_off", concrete, [concrete])).pipe(Effect.forkScoped)
            expect(yield* wait(1)).toHaveLength(1)
            yield* reply({ requestID: PermissionV1.ID.make("per_skill_project_off"), reply: "always" })
            yield* Fiber.await(first)
            // The global skill guard still narrows persistence to the exact skill subtree.
            const written = yield* Effect.promise(text)
            expect(written).toContain(skill)
            expect(written).not.toContain(concrete)
          }),
        ),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  // --- canonical boundary scoping and direct project config freshness ---

  const link = process.platform === "win32" ? "junction" : "dir"

  it.live("global false with project true protects an outside alias into the project", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const alias = path.join(path.dirname(dir), "opencode-test-alias-in-" + Math.random().toString(36).slice(2))
          yield* Effect.promise(() => fs.symlink(dir, alias, link))
          try {
            yield* withGlobal({ require_approval_for_config_edits: false })
            const file = path.join(alias, ".kilo", "kilo.json")
            const fiber = yield* ask(scoped("per_alias_in", file)).pipe(Effect.forkScoped)
            const items = yield* wait(1)
            // Config-protected, not an ordinary ask: project scope re-enabled protection.
            expect(items[0]?.metadata).toMatchObject({ disableAlways: true, configProtected: true })
            yield* reject("per_alias_in")
            yield* Fiber.await(fiber)
          } finally {
            yield* Effect.promise(() => fs.rm(alias, { recursive: true, force: true }))
          }
        }),
      { git: true, config: { require_approval_for_config_edits: true } },
    ),
  )

  it.live("project false still protects an inside alias that escapes the project", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const outside = path.join(path.dirname(dir), "opencode-test-alias-out-" + Math.random().toString(36).slice(2))
          const escape = path.join(dir, "escape")
          yield* Effect.promise(() => fs.mkdir(outside, { recursive: true }))
          yield* Effect.promise(() => fs.symlink(outside, escape, link))
          try {
            yield* withGlobal({ require_approval_for_config_edits: true })
            const file = path.join(escape, ".kilo", "kilo.json")
            const fiber = yield* ask(scoped("per_alias_out", file)).pipe(Effect.forkScoped)
            const items = yield* wait(1)
            expect(items[0]?.metadata).toMatchObject({ disableAlways: true, configProtected: true })
            yield* reject("per_alias_out")
            yield* Fiber.await(fiber)
          } finally {
            yield* Effect.promise(() => fs.rm(escape, { recursive: true, force: true }))
            yield* Effect.promise(() => fs.rm(outside, { recursive: true, force: true }))
          }
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("observes direct project config edits at the permission boundary", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const file = path.join(dir, "kilo.json")
          const write = (value: object | undefined) =>
            Effect.promise(async () => {
              if (value === undefined) await fs.rm(file, { force: true })
              else await fs.writeFile(file, JSON.stringify(value, null, 2))
            })

          // No project config: protected under the default.
          const blocked = yield* ask(request("per_disk_blocked")).pipe(Effect.forkScoped)
          const initial = yield* wait(1)
          expect(initial[0]?.metadata).toMatchObject({ disableAlways: true, configProtected: true })
          yield* reject("per_disk_blocked")
          yield* Fiber.await(blocked)

          // Direct disk edit (no Config.update) turns protection off for this project.
          yield* write({ require_approval_for_config_edits: false })
          expect((yield* ask(request("per_disk_off"))).manual).toBe(false)

          // Direct disk edit turns it back on.
          yield* write({ require_approval_for_config_edits: true })
          const reenabled = yield* ask(request("per_disk_on")).pipe(Effect.forkScoped)
          expect((yield* wait(1))[0]?.metadata).toMatchObject({ configProtected: true })
          yield* reject("per_disk_on")
          yield* Fiber.await(reenabled)

          // Deleting the file restores the default.
          yield* write(undefined)
          const removed = yield* ask(request("per_disk_removed")).pipe(Effect.forkScoped)
          expect((yield* wait(1))[0]?.metadata).toMatchObject({ configProtected: true })
          yield* reject("per_disk_removed")
          yield* Fiber.await(removed)
        }),
      { git: true },
    ),
  )

  it.live("direct project true re-enables protection when the global value is false", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* withGlobal({ require_approval_for_config_edits: false })
          yield* Effect.promise(() =>
            fs.writeFile(
              path.join(dir, "kilo.json"),
              JSON.stringify({ require_approval_for_config_edits: true }, null, 2),
            ),
          )
          const fiber = yield* ask(request("per_disk_reenable")).pipe(Effect.forkScoped)
          expect((yield* wait(1))[0]?.metadata).toMatchObject({ configProtected: true })
          yield* reject("per_disk_reenable")
          yield* Fiber.await(fiber)
        }),
      { git: true },
    ),
  )

  it.live("project false does not weaken ordinary rules for outside config filenames", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const outside = path.join(
            dir,
            "..",
            "opencode-test-outside-root-" + Math.random().toString(36).slice(2),
            "AGENTS.md",
          )
          const auto = yield* ask(
            request("per_outside_auto", { patterns: [outside], metadata: { filepath: outside }, always: [outside] }),
          )
          expect(auto.manual).toBe(false)

          const asked = yield* ask(
            request("per_outside_ask", {
              patterns: [outside],
              metadata: { filepath: outside },
              always: [outside],
              ruleset: [],
            }),
          ).pipe(Effect.forkScoped)
          const items = yield* wait(1)
          expect(items[0]?.metadata?.configProtected).toBeUndefined()
          yield* reject("per_outside_ask")
          yield* Fiber.await(asked)
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  // --- symlinked project config and nonstandard source freshness ---

  it.live("protects a project config symlink to an ordinary same-project file", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(path.join(dir, ".kilo"), { recursive: true }))
          yield* Effect.promise(() => fs.writeFile(path.join(dir, "settings.json"), "{}"))
          const file = path.join(dir, ".kilo", "kilo.json")
          yield* Effect.promise(() => fs.symlink(path.join(dir, "settings.json"), file, "file"))
          try {
            // Global false, project true: the lexical protected path must still re-enable protection.
            yield* withGlobal({ require_approval_for_config_edits: false })
            const fiber = yield* ask(scoped("per_symlink_protected", file)).pipe(Effect.forkScoped)
            expect((yield* wait(1))[0]?.metadata).toMatchObject({
              disableAlways: true,
              configProtected: true,
            })
            yield* reject("per_symlink_protected")
            yield* Fiber.await(fiber)
          } finally {
            yield* Effect.promise(() => fs.rm(file, { force: true }))
          }
        }),
      { git: true, config: { require_approval_for_config_edits: true } },
    ),
  )

  it.live("applies a project opt-out to a project config symlink to an ordinary file", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(path.join(dir, ".kilo"), { recursive: true }))
          yield* Effect.promise(() => fs.writeFile(path.join(dir, "settings.json"), "{}"))
          const file = path.join(dir, ".kilo", "kilo.json")
          yield* Effect.promise(() => fs.symlink(path.join(dir, "settings.json"), file, "file"))
          try {
            const outcome = yield* ask(
              request("per_symlink_off", { patterns: [file], metadata: { filepath: file }, always: [file] }),
            )
            expect(outcome.manual).toBe(false)
          } finally {
            yield* Effect.promise(() => fs.rm(file, { force: true }))
          }
        }),
      { git: true, config: { require_approval_for_config_edits: false } },
    ),
  )

  it.live("observes direct edits to a KILO_CONFIG_DIR config", () => {
    const conf = path.join(os.tmpdir(), "opencode-test-confdir-" + Math.random().toString(36).slice(2))
    return withConfigDir(
      conf,
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            yield* withGlobal(undefined)
            yield* Effect.promise(() => fs.mkdir(conf, { recursive: true }))

            const blocked = yield* ask(request("per_confdir_blocked")).pipe(Effect.forkScoped)
            expect((yield* wait(1))[0]?.metadata).toMatchObject({ configProtected: true })
            yield* reject("per_confdir_blocked")
            yield* Fiber.await(blocked)

            yield* Effect.promise(() =>
              fs.writeFile(path.join(conf, "kilo.json"), JSON.stringify({ require_approval_for_config_edits: false })),
            )
            expect((yield* ask(request("per_confdir_off"))).manual).toBe(false)
          }),
        { git: true },
      ),
    )
  })

  it.instance("observes direct primary-checkout edits for a linked worktree", () =>
    Effect.gen(function* () {
      const primary = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(() => fs.mkdir(path.join(primary, ".kilo"), { recursive: true }))
      const config = path.join(primary, ".kilo", "kilo.json")
      yield* Effect.promise(() => fs.writeFile(config, JSON.stringify({ require_approval_for_config_edits: false })))
      const branch = "linked-" + Math.random().toString(36).slice(2)
      const linked = path.join(path.dirname(primary), path.basename(primary) + "-" + branch)
      yield* Effect.promise(() => $`git worktree add -b ${branch} ${linked}`.cwd(primary).quiet())

      try {
        yield* withGlobal(undefined)
        yield* provideInstance(linked)(
          Effect.gen(function* () {
            // The linked worktree inherits the primary checkout's project config.
            expect((yield* ask(request("per_linked_off"))).manual).toBe(false)

            // A direct edit in the primary checkout is observed without Config.update.
            yield* Effect.promise(() =>
              fs.writeFile(config, JSON.stringify({ require_approval_for_config_edits: true })),
            )
            const fiber = yield* ask(request("per_linked_on")).pipe(Effect.forkScoped)
            expect((yield* wait(1))[0]?.metadata).toMatchObject({ configProtected: true })
            yield* reject("per_linked_on")
            yield* Fiber.await(fiber)
          }),
        )
      } finally {
        yield* Effect.promise(() => $`git worktree remove --force ${linked}`.cwd(primary).quiet().nothrow())
      }
    }),
  )

  it.instance("scopes project config freshness to each project instance", () =>
    Effect.gen(function* () {
      const a = yield* tmpdirScoped({ git: true })
      const b = yield* tmpdirScoped({ git: true })
      yield* withGlobal(undefined)

      yield* provideInstance(a)(
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            fs.writeFile(path.join(a, "kilo.json"), JSON.stringify({ require_approval_for_config_edits: false })),
          )
          expect((yield* ask(request("per_scope_a"))).manual).toBe(false)
        }),
      )

      // A's project opt-out must not leak into B.
      yield* provideInstance(b)(
        Effect.gen(function* () {
          const fiber = yield* ask(request("per_scope_b")).pipe(Effect.forkScoped)
          expect((yield* wait(1))[0]?.metadata).toMatchObject({ configProtected: true })
          yield* reject("per_scope_b")
          yield* Fiber.await(fiber)
        }),
      )
    }),
  )

  it.live("still loads the policy for an ordinary reply with a config sibling", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          const config = yield* ask(request("per_mixed_config")).pipe(Effect.forkScoped)
          expect(yield* wait(1)).toHaveLength(1)

          const ordinary = yield* ask(
            request("per_mixed_ordinary", {
              patterns: ["src/index.ts"],
              metadata: { filepath: "src/index.ts" },
              always: ["src/index.ts"],
              ruleset: [],
            }),
          ).pipe(Effect.forkScoped)
          expect(yield* wait(2)).toHaveLength(2)

          // The reply entry is not config-shaped, so the lazy gate must still resolve the config
          // sibling and load the policy before drain skips that sibling.
          yield* reply({ requestID: PermissionV1.ID.make("per_mixed_ordinary"), reply: "always" })
          yield* Fiber.await(ordinary)
          expect((yield* list()).map((item) => item.id)).toEqual([PermissionV1.ID.make("per_mixed_config")])

          yield* reject("per_mixed_config")
          yield* Fiber.await(config)
        }),
      { git: true },
    ),
  )

  it.live("narrows an aliased global-skill read to the canonical skill before persisting", () =>
    provideTmpdirInstance(
      () =>
        withSkill("per_read_alias", ({ skill, concrete }) =>
          Effect.gen(function* () {
            yield* withGlobal(undefined)
            const permission = yield* Permission.Service
            const skillDir = path.dirname(concrete)
            const alias = path.join(os.tmpdir(), `opencode-read-alias-${process.pid}-${Date.now()}`)
            const aliasGlob = path.join(alias, "*").replaceAll("\\", "/")
            const link = process.platform === "win32" ? "junction" : "dir"
            yield* Effect.promise(() => fs.writeFile(concrete, "body"))
            yield* Effect.promise(() => fs.symlink(skillDir, alias, link))

            yield* Effect.gen(function* () {
              const first = yield* assertExternalDirectoryEffect(
                toolCtx(permission, "per_read_alias_first"),
                path.join(alias, "SKILL.md"),
                { kind: "file" },
              ).pipe(Effect.forkScoped)
              const items = yield* wait(1)
              // A file-tool read is not config-protected, but its canonical skill scope must still
              // replace the alias so an "always" reply cannot persist the alias itself.
              expect(items[0]?.always).toEqual([skill])
              expect(items[0]?.metadata).toMatchObject({ rules: [skill] })
              yield* reply({ requestID: items[0].id, reply: "always" })
              expect(Exit.isSuccess(yield* Fiber.await(first))).toBe(true)

              const written = yield* Effect.promise(() => text())
              expect(written).toContain(skill)
              expect(written).not.toContain(aliasGlob)

              // Retarget the alias outside any skill. The saved canonical rule must not authorize the read.
              const other = path.join(os.tmpdir(), `opencode-read-other-${process.pid}-${Date.now()}`)
              yield* Effect.promise(() => fs.mkdir(other, { recursive: true }))
              yield* Effect.promise(() => fs.writeFile(path.join(other, "secret.txt"), "x"))
              yield* Effect.promise(() => fs.rm(alias, { recursive: true, force: true }))
              yield* Effect.promise(() => fs.symlink(other, alias, link))

              const second = yield* assertExternalDirectoryEffect(
                toolCtx(permission, "per_read_alias_second"),
                path.join(alias, "secret.txt"),
                { kind: "file" },
              ).pipe(Effect.forkScoped)
              expect(yield* wait(1)).toHaveLength(1)
              yield* reject("per_read_alias_second")
              expect(Exit.isFailure(yield* Fiber.await(second))).toBe(true)
              yield* Effect.promise(() => fs.rm(other, { recursive: true, force: true }))
            }).pipe(Effect.ensuring(Effect.promise(() => fs.rm(alias, { recursive: true, force: true }))))
          }),
        ),
      { git: true },
    ),
  )

  it.live("persists the canonical skill when saving always rules for an aliased read", () =>
    provideTmpdirInstance(
      () =>
        withSkill("per_read_save", ({ skill, concrete }) =>
          Effect.gen(function* () {
            yield* withGlobal(undefined)
            const permission = yield* Permission.Service
            const skillDir = path.dirname(concrete)
            const alias = path.join(os.tmpdir(), `opencode-read-save-${process.pid}-${Date.now()}`)
            const aliasGlob = path.join(alias, "*").replaceAll("\\", "/")
            const link = process.platform === "win32" ? "junction" : "dir"
            yield* Effect.promise(() => fs.writeFile(concrete, "body"))
            yield* Effect.promise(() => fs.symlink(skillDir, alias, link))

            yield* Effect.gen(function* () {
              const fiber = yield* assertExternalDirectoryEffect(
                toolCtx(permission, "per_read_save_first"),
                path.join(alias, "SKILL.md"),
                { kind: "file" },
              ).pipe(Effect.forkScoped)
              const items = yield* wait(1)
              yield* saveAlwaysRules({ requestID: items[0].id, approvedAlways: [skill] })

              const written = yield* Effect.promise(() => text())
              expect(written).toContain(skill)
              expect(written).not.toContain(aliasGlob)

              yield* reject("per_read_save_first")
              yield* Fiber.await(fiber)
            }).pipe(Effect.ensuring(Effect.promise(() => fs.rm(alias, { recursive: true, force: true }))))
          }),
        ),
      { git: true },
    ),
  )

  it.live("uses legacy home global sources for the global policy", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        legacyHome({
          ".kilo/kilo.json": JSON.stringify({ require_approval_for_config_edits: false }),
          ".kilocode/kilo.jsonc": JSON.stringify({ require_approval_for_config_edits: false }),
        }),
      )
      yield* withGlobal(undefined)
      yield* withHome(
        home,
        provideTmpdirInstance(
          () =>
            Effect.gen(function* () {
              // Project targets already read the effective config; legacy global targets must too.
              yield* auto("per_legacy_project", target)
              yield* auto("per_legacy_kilo", path.join(home, ".kilo", "kilo.json"))
              yield* auto("per_legacy_kilocode", path.join(home, ".kilocode", "kilo.jsonc"))
            }),
          { git: true },
        ),
      ).pipe(Effect.ensuring(Effect.promise(() => fs.rm(home, { recursive: true, force: true }))))
    }),
  )

  it.live("uses the primary global false for legacy home targets", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() => legacyHome({}))
      yield* withGlobal({ require_approval_for_config_edits: false })
      yield* withHome(
        home,
        provideTmpdirInstance(
          () =>
            Effect.gen(function* () {
              yield* auto("per_primary_false_kilo", path.join(home, ".kilo", "kilo.json"))
            }),
          { git: true },
        ),
      ).pipe(Effect.ensuring(Effect.promise(() => fs.rm(home, { recursive: true, force: true }))))
    }),
  )

  it.live("lets a legacy global value win over the primary global value, matching the loader", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        legacyHome({ ".kilo/kilo.json": JSON.stringify({ require_approval_for_config_edits: true }) }),
      )
      yield* withGlobal({ require_approval_for_config_edits: false })
      yield* withHome(
        home,
        provideTmpdirInstance(
          () =>
            Effect.gen(function* () {
              // The loader merges legacy home dirs after the primary global config, so true wins and
              // the effective project value is true too.
              yield* prompts("per_legacy_precedence_project", target)
              yield* prompts("per_legacy_precedence_kilo", path.join(home, ".kilo", "kilo.json"))
            }),
          { git: true },
        ),
      ).pipe(Effect.ensuring(Effect.promise(() => fs.rm(home, { recursive: true, force: true }))))
    }),
  )

  it.live("re-reads legacy global files on every policy load", () =>
    Effect.gen(function* () {
      const file = ".kilo/kilo.json"
      const home = yield* Effect.promise(() =>
        legacyHome({ [file]: JSON.stringify({ require_approval_for_config_edits: false }) }),
      )
      yield* withGlobal(undefined)
      yield* withHome(
        home,
        provideTmpdirInstance(
          () =>
            Effect.gen(function* () {
              const legacy = path.join(home, file)
              yield* auto("per_legacy_fresh_1", legacy)
              yield* Effect.promise(() =>
                fs.writeFile(legacy, JSON.stringify({ require_approval_for_config_edits: true })),
              )
              yield* prompts("per_legacy_fresh_2", legacy)
              yield* Effect.promise(() =>
                fs.writeFile(legacy, JSON.stringify({ require_approval_for_config_edits: false })),
              )
              yield* auto("per_legacy_fresh_3", legacy)
            }),
          { git: true },
        ),
      ).pipe(Effect.ensuring(Effect.promise(() => fs.rm(home, { recursive: true, force: true }))))
    }),
  )

  it.live("tolerates malformed legacy global config without aborting a permission ask", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        legacyHome({
          ".kilo/kilo.json": '{ "require_approval_for_config_edits": ',
          ".kilocode/kilo.jsonc": JSON.stringify({ require_approval_for_config_edits: "nope" }),
        }),
      )
      yield* withGlobal(undefined)
      yield* withHome(
        home,
        provideTmpdirInstance(
          () =>
            Effect.gen(function* () {
              // A broken legacy file is skipped like the normal loader's directory pass, so the default
              // strict policy still applies and the ask prompts instead of dying during policy load.
              yield* prompts("per_legacy_malformed_jsonc", path.join(home, ".kilo", "kilo.json"))
              yield* prompts("per_legacy_malformed_schema", path.join(home, ".kilocode", "kilo.jsonc"))
            }),
          { git: true },
        ),
      ).pipe(Effect.ensuring(Effect.promise(() => fs.rm(home, { recursive: true, force: true }))))
    }),
  )

  it.live("preserves a valid primary global value when a legacy global file is malformed", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() => legacyHome({ ".kilo/kilo.json": "{ not json" }))
      yield* withGlobal({ require_approval_for_config_edits: false })
      yield* withHome(
        home,
        provideTmpdirInstance(
          () =>
            Effect.gen(function* () {
              // The malformed legacy file is skipped, so the primary explicit false still opts out; the
              // project target confirms no other setting is responsible.
              yield* auto("per_primary_kept_malformed_project", target)
              yield* auto("per_primary_kept_malformed_kilo", path.join(home, ".kilo", "kilo.json"))
            }),
          { git: true },
        ),
      ).pipe(Effect.ensuring(Effect.promise(() => fs.rm(home, { recursive: true, force: true }))))
    }),
  )

  it.live("matches the loader precedence between conflicting .kilocode and .kilo globals", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        legacyHome({
          ".kilocode/kilo.json": JSON.stringify({ require_approval_for_config_edits: false }),
          ".kilo/kilo.json": JSON.stringify({ require_approval_for_config_edits: true }),
        }),
      )
      yield* withGlobal(undefined)
      yield* withHome(
        home,
        provideTmpdirInstance(
          () =>
            Effect.gen(function* () {
              // The loader discovers home dirs in [.kilocode, .kilo] order and later merges win, so the
              // .kilo true overrides the .kilocode false for every global target.
              yield* prompts("per_home_order_prompt", path.join(home, ".kilo", "kilo.json"))

              // Reversing the values flips the policy, proving the order and the per-load freshness.
              yield* Effect.promise(() =>
                fs.writeFile(
                  path.join(home, ".kilocode", "kilo.json"),
                  JSON.stringify({ require_approval_for_config_edits: true }),
                ),
              )
              yield* Effect.promise(() =>
                fs.writeFile(
                  path.join(home, ".kilo", "kilo.json"),
                  JSON.stringify({ require_approval_for_config_edits: false }),
                ),
              )
              yield* auto("per_home_order_auto", path.join(home, ".kilo", "kilo.json"))
            }),
          { git: true },
        ),
      ).pipe(Effect.ensuring(Effect.promise(() => fs.rm(home, { recursive: true, force: true }))))
    }),
  )

  it.live("project false overrides a legacy home global true", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        legacyHome({ ".kilo/kilo.json": JSON.stringify({ require_approval_for_config_edits: true }) }),
      )
      yield* withGlobal(undefined)
      yield* withHome(
        home,
        provideTmpdirInstance(() => auto("per_project_beats_legacy_off", target), {
          git: true,
          config: { require_approval_for_config_edits: false },
        }),
      ).pipe(Effect.ensuring(Effect.promise(() => fs.rm(home, { recursive: true, force: true }))))
    }),
  )

  it.live("project true overrides legacy home globals that disable protection", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        legacyHome({
          ".kilo/kilo.json": JSON.stringify({ require_approval_for_config_edits: false }),
          ".kilocode/kilo.jsonc": JSON.stringify({ require_approval_for_config_edits: false }),
        }),
      )
      yield* withGlobal(undefined)
      yield* withHome(
        home,
        provideTmpdirInstance(() => prompts("per_project_beats_legacy_on", target), {
          git: true,
          config: { require_approval_for_config_edits: true },
        }),
      ).pipe(Effect.ensuring(Effect.promise(() => fs.rm(home, { recursive: true, force: true }))))
    }),
  )

  it.live("keeps the legacy global fallback when the project does not set the value", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        legacyHome({ ".kilo/kilo.json": JSON.stringify({ require_approval_for_config_edits: true }) }),
      )
      yield* withGlobal(undefined)
      yield* withHome(
        home,
        provideTmpdirInstance(() => prompts("per_legacy_fallback_project", target), { git: true }),
      ).pipe(Effect.ensuring(Effect.promise(() => fs.rm(home, { recursive: true, force: true }))))
    }),
  )

  it.live("a project override does not change the global policy for global targets", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        legacyHome({ ".kilo/kilo.json": JSON.stringify({ require_approval_for_config_edits: true }) }),
      )
      yield* withGlobal(undefined)
      yield* withHome(
        home,
        provideTmpdirInstance(
          () =>
            Effect.gen(function* () {
              // The project value overrides the legacy global value for the project's own files...
              yield* auto("per_project_override_local", target)
              // ...but the legacy global policy still protects global config targets.
              yield* prompts("per_project_override_global", path.join(home, ".kilo", "kilo.json"))
            }),
          { git: true, config: { require_approval_for_config_edits: false } },
        ),
      ).pipe(Effect.ensuring(Effect.promise(() => fs.rm(home, { recursive: true, force: true }))))
    }),
  )

  it.live("an explicit project value overrides KILO_CONFIG when they conflict", () => {
    const file = path.join(os.tmpdir(), "opencode-test-kiloconfig-" + Math.random().toString(36).slice(2) + ".json")
    return withEnv(
      "KILO_CONFIG",
      file,
      Effect.gen(function* () {
        yield* withGlobal(undefined)
        yield* Effect.promise(() => fs.writeFile(file, JSON.stringify({ require_approval_for_config_edits: false })))
        yield* provideTmpdirInstance(
          () =>
            Effect.gen(function* () {
              // KILO_CONFIG loads before the project files, so an explicit project true still wins.
              yield* prompts("per_kiloconfig_project", target)
            }),
          { git: true, config: { require_approval_for_config_edits: true } },
        )
      }).pipe(Effect.ensuring(Effect.promise(() => fs.rm(file, { force: true })))),
    )
  })

  it.live("keeps KILO_CONFIG_DIR precedence over an explicit project value", () => {
    const conf = path.join(os.tmpdir(), "opencode-test-confdir-priority-" + Math.random().toString(36).slice(2))
    return withConfigDir(
      conf,
      Effect.gen(function* () {
        yield* withGlobal(undefined)
        yield* Effect.promise(async () => {
          await fs.mkdir(conf, { recursive: true })
          await fs.writeFile(path.join(conf, "kilo.json"), JSON.stringify({ require_approval_for_config_edits: false }))
        })
        yield* provideTmpdirInstance(() => auto("per_confdir_beats_project", target), {
          git: true,
          config: { require_approval_for_config_edits: true },
        })
      }).pipe(Effect.ensuring(Effect.promise(() => fs.rm(conf, { recursive: true, force: true })))),
    )
  })

  it.live("keeps KILO_CONFIG_DIR precedence when it aliases a legacy home dir", () =>
    Effect.gen(function* () {
      for (const c of [
        { dir: ".kilo", id: "kilo" },
        { dir: ".kilocode", id: "kilocode" },
      ]) {
        const home = yield* Effect.promise(() =>
          legacyHome({ [`${c.dir}/kilo.json`]: JSON.stringify({ require_approval_for_config_edits: false }) }),
        )
        yield* withConfigDir(
          path.join(home, c.dir),
          Effect.gen(function* () {
            yield* withGlobal(undefined)
            yield* withHome(
              home,
              provideTmpdirInstance(() => auto(`per_env_alias_${c.id}`, target), {
                git: true,
                config: { require_approval_for_config_edits: true },
              }),
            ).pipe(Effect.ensuring(Effect.promise(() => fs.rm(home, { recursive: true, force: true }))))
          }),
        )
      }
    }),
  )

  it.live("keeps an aliased KILO_CONFIG_DIR ahead of the project and other legacy home dirs", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        legacyHome({
          ".kilocode/kilo.json": JSON.stringify({ require_approval_for_config_edits: true }),
          ".kilo/kilo.json": JSON.stringify({ require_approval_for_config_edits: false }),
        }),
      )
      yield* withConfigDir(
        path.join(home, ".kilo"),
        Effect.gen(function* () {
          yield* withGlobal(undefined)
          yield* withHome(
            home,
            provideTmpdirInstance(() => auto("per_env_alias_kilo_beats", target), {
              git: true,
              config: { require_approval_for_config_edits: true },
            }),
          ).pipe(Effect.ensuring(Effect.promise(() => fs.rm(home, { recursive: true, force: true }))))
        }),
      )
    }),
  )

  it.live("keeps KILO_CONFIG_DIR precedence when it aliases the primary global config dir", () => {
    const prevConfig = Global.Path.config
    return Effect.gen(function* () {
      const globalDir = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-env-primary-")))
      ;(Global.Path as { config: string }).config = globalDir
      yield* withConfigDir(
        globalDir,
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            fs.writeFile(
              path.join(globalDir, "kilo.json"),
              JSON.stringify({ require_approval_for_config_edits: false }),
            ),
          )
          yield* provideTmpdirInstance(() => auto("per_env_alias_primary", target), {
            git: true,
            config: { require_approval_for_config_edits: true },
          }).pipe(Effect.ensuring(Effect.promise(() => fs.rm(globalDir, { recursive: true, force: true }))))
        }),
      )
    }).pipe(Effect.ensuring(Effect.sync(() => ((Global.Path as { config: string }).config = prevConfig))))
  })

  it.live("keeps a project value when KILO_CONFIG_DIR aliases the primary global dir without its own field", () =>
    Effect.gen(function* () {
      for (const c of [
        { id: "on", legacy: false, project: true, check: prompts },
        { id: "off", legacy: true, project: false, check: auto },
      ]) {
        const home = yield* Effect.promise(() =>
          legacyHome({ ".kilo/kilo.json": JSON.stringify({ require_approval_for_config_edits: c.legacy }) }),
        )
        yield* withConfigDir(
          Global.Path.config,
          Effect.gen(function* () {
            yield* withGlobal(undefined)
            yield* withHome(
              home,
              provideTmpdirInstance(() => c.check(`per_env_primary_no_field_${c.id}`, target), {
                git: true,
                config: { require_approval_for_config_edits: c.project },
              }),
            ).pipe(Effect.ensuring(Effect.promise(() => fs.rm(home, { recursive: true, force: true }))))
          }),
        )
      }
    }),
  )

  it.live("keeps an explicit aliased KILO_CONFIG_DIR field ahead of a later legacy home dir", () =>
    Effect.gen(function* () {
      for (const c of [
        { id: "off", kilocode: false, kilo: true, check: auto },
        { id: "on", kilocode: true, kilo: false, check: prompts },
      ]) {
        const home = yield* Effect.promise(() =>
          legacyHome({
            ".kilocode/kilo.json": JSON.stringify({ require_approval_for_config_edits: c.kilocode }),
            ".kilo/kilo.json": JSON.stringify({ require_approval_for_config_edits: c.kilo }),
          }),
        )
        yield* withConfigDir(
          path.join(home, ".kilocode"),
          Effect.gen(function* () {
            yield* withGlobal(undefined)
            yield* withHome(
              home,
              provideTmpdirInstance(() => c.check(`per_env_field_beats_later_legacy_${c.id}`, target), { git: true }),
            ).pipe(Effect.ensuring(Effect.promise(() => fs.rm(home, { recursive: true, force: true }))))
          }),
        )
      }
    }),
  )

  it.live("keeps a project .kilo directory that loads after an aliased primary KILO_CONFIG_DIR", () =>
    withConfigDir(
      Global.Path.config,
      Effect.gen(function* () {
        yield* withGlobal({ require_approval_for_config_edits: false })
        yield* provideTmpdirInstance(
          (dir) =>
            Effect.gen(function* () {
              yield* Effect.promise(async () => {
                await fs.mkdir(path.join(dir, ".kilo"), { recursive: true })
                await fs.writeFile(
                  path.join(dir, ".kilo", "kilo.json"),
                  JSON.stringify({ require_approval_for_config_edits: true }),
                )
              })
              yield* prompts("per_env_primary_project_dir_on", target)
            }),
          { git: true },
        )
      }),
    ),
  )
})

const editRequest = (id: string, file: string): Permission.AskInput =>
  request(id, {
    patterns: [file],
    metadata: { filepath: file },
    always: [file],
    ruleset: [{ permission: "edit", pattern: "*", action: "allow" }],
  })

// Create one global skill root for a test and always remove it, even when the effect fails or is
// interrupted. The name is unique to this file and the root lives under the test process's
// XDG_CONFIG_HOME, so removing exactly the directory this helper created cannot delete a real skill.
const withSkill = <A, E, R>(
  name: string,
  use: (created: { skill: string; concrete: string; dir: string }) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const dir = path.join(Global.Path.config, "skills", name)
      await fs.mkdir(dir, { recursive: true })
      return dir
    }),
    (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
  ).pipe(
    Effect.flatMap((dir) => {
      const raw = path.join(dir, "*").replaceAll("\\", "/")
      const skill = ConfigProtection.globalSkillPattern({ permission: "external_directory", patterns: [raw] })
      if (!skill) return Effect.die(new Error(`expected a global skill pattern for ${dir}`))
      return use({ skill, concrete: skill.slice(0, -2) + "/SKILL.md", dir })
    }),
  )
