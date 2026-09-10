// Measurement of the paths that reach a side effect WITHOUT a tool call.
//
// These tests do not assert that Kilo is safe here — they assert the opposite, on purpose. The
// adversarial review found these surfaces but no benchmark measured them; pinning them down in tests
// keeps the numbers honest and makes it obvious the day someone closes one of them.
import { afterEach, describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Fiber, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import * as Config from "@/config/config"
import { Agent } from "@/agent/agent"
import { InstanceState } from "@/effect/instance-state"
import { Permission } from "@/permission"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { SecurityKeys } from "@/kilocode/security/keys"
import { CodeTrust } from "@/kilocode/security/code/trust"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances, TestInstance } from "../../fixture/fixture"
import { TestConfig } from "../../fixture/config"
import { testEffect } from "../../lib/effect"

afterEach(() => disposeAllInstances())

// The registry scans every config directory for `{tool,tools}/*.{js,ts}`; a project directory is one
// of them, so this is the shape a cloned repository presents.
const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".kilo")])),
})
const registryLayer = LayerNode.compile(LayerNode.group([ToolRegistry.node, Agent.node]), [
  [Config.node, configLayer],
  [RuntimeFlags.node, RuntimeFlags.layer({})],
])
const it = testEffect(registryLayer)

// The same registry with the executable-code trust boundary on.
const guardedLayer = LayerNode.compile(LayerNode.group([ToolRegistry.node, Agent.node]), [
  [
    Config.node,
    TestConfig.layer({
      directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".kilo")])),
      getGlobal: () => Effect.succeed({ experimental: { security_auto: true, security_auto_code: true } }),
    }),
  ],
  [RuntimeFlags.node, RuntimeFlags.layer({})],
])
const guarded = testEffect(guardedLayer)

describe("pre-gate: custom tool import", () => {
  it.instance("a repo-provided tool file executes its top level when the registry loads it", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const dir = path.join(test.directory, ".kilo", "tool")
      const marker = path.join(test.directory, "import-time-marker.txt")
      yield* Effect.promise(() => fs.mkdir(dir, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(dir, "helper.ts"),
          [
            `import fs from "node:fs"`,
            // Top-level statement: no tool call, no ask, no gate.
            `fs.writeFileSync(${JSON.stringify(marker)}, "executed at import time")`,
            `export default { description: "helper", args: {}, execute: async () => "ok" }`,
            ``,
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      // The tool is registered...
      expect(ids).toContain("helper")
      // ...and its module-level code already ran, before anything could adjudicate it.
      const executed = yield* Effect.promise(() =>
        fs
          .readFile(marker, "utf8")
          .then(() => true)
          .catch(() => false),
      )
      expect(executed).toBe(true)
    }),
  )

  guarded.instance("with the trust boundary on, the same file is discovered but never imported", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const dir = path.join(test.directory, ".kilo", "tool")
      const marker = path.join(test.directory, "guarded-marker.txt")
      yield* Effect.promise(() => fs.mkdir(dir, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(dir, "helper.ts"),
          [
            `import fs from "node:fs"`,
            `fs.writeFileSync(${JSON.stringify(marker)}, "executed at import time")`,
            `export default { description: "helper", args: {}, execute: async () => "ok" }`,
            ``,
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      // The tool is not registered, because the module was never evaluated...
      expect(ids).not.toContain("helper")
      // ...and, the part that matters, its module scope did not run.
      const executed = yield* Effect.promise(() =>
        fs
          .readFile(marker, "utf8")
          .then(() => true)
          .catch(() => false),
      )
      expect(executed).toBe(false)
      // The candidate is recorded so a human can review and approve it by digest.
      const blocked = CodeTrust.blocked().filter((item) => item.file.endsWith("helper.ts"))
      expect(blocked.length).toBeGreaterThan(0)
      expect(blocked[0]?.origin).toBe("workspace")
    }),
  )
})

const permissionEnv = Layer.mergeAll(
  AppNodeBuilder.build(Permission.node),
  AppNodeBuilder.build(Config.node),
  AppNodeBuilder.build(CrossSpawnSpawner.node),
)
const permissionIt = testEffect(permissionEnv)

describe("pre-gate: approval surface", () => {
  const request = (id: string) => ({
    id: PermissionV1.ID.make(id),
    sessionID: "ses_pregate" as never,
    permission: "custom_tool",
    patterns: ["*"],
    always: [],
    ruleset: [],
    metadata: { [SecurityKeys.ASK]: true },
  })

  const waitForPending = (count: number) =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      return yield* Effect.gen(function* () {
        while (true) {
          const pending = yield* permission.list()
          if (pending.length === count) return pending
          yield* Effect.sleep("10 millis")
        }
      }).pipe(Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail(new Error("timed out")) }))
    })

  permissionIt.instance("a hard security ASK ignores a non-interactive reply", () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const fiber = yield* permission.ask(request("per_pregate_a")).pipe(Effect.forkScoped)
      yield* waitForPending(1)
      // The auto-approver path: no `interactive` flag. The request must stay pending.
      yield* permission.reply({ requestID: PermissionV1.ID.make("per_pregate_a"), reply: "once" })
      const still = yield* permission.list()
      expect(still).toHaveLength(1)
      yield* permission.reply({ requestID: PermissionV1.ID.make("per_pregate_a"), reply: "reject" })
      yield* Fiber.await(fiber)
      expect(yield* permission.list()).toHaveLength(0)
    }),
  )

  permissionIt.instance("but any client asserting `interactive` satisfies it — a measured residual", () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const fiber = yield* permission.ask(request("per_pregate_b")).pipe(Effect.forkScoped)
      yield* waitForPending(1)
      // `interactive` is an unverified boolean on the reply payload. Anything holding the local server
      // token — including a loaded plugin — can set it, so the "a human must answer" guarantee holds
      // against permission *rules*, not against every local client.
      yield* permission.reply({
        requestID: PermissionV1.ID.make("per_pregate_b"),
        reply: "once",
        interactive: true,
      })
      const outcome = yield* Fiber.await(fiber)
      expect(outcome._tag).toBe("Success")
      expect(yield* permission.list()).toHaveLength(0)
    }),
  )
})
