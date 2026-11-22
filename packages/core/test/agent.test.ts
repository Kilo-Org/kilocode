import { describe, expect } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { AgentPlugin } from "@opencode-ai/core/plugin/agent"
import { PermissionV2 } from "@opencode-ai/core/permission" // kilocode_change
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { agentHost, host } from "./plugin/host"

const it = testEffect(AppNodeBuilder.build(AgentV2.node))

describe("AgentV2", () => {
  it.effect("starts without agents", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service

      expect(yield* agent.all()).toEqual([])
      expect(yield* agent.get(AgentV2.ID.make("build"))).toBeUndefined()
    }),
  )

  it.effect("materializes replayable agent transforms", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("reviewer")
      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.description = "Reviews code"
          info.mode = "subagent"
        }),
      )

      expect(yield* agent.get(id)).toMatchObject({ id, description: "Reviews code", mode: "subagent" })
      expect((yield* agent.all()).map((info) => info.id)).toEqual([id])
    }),
  )

  it.effect("rebuilds state when a transform is replaced", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("reviewer")
      let description = "Old description"
      let hidden = true
      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.description = description
          info.hidden = hidden
        }),
      )
      description = "New description"
      hidden = false
      yield* agent.reload()

      expect(yield* agent.get(id)).toMatchObject({ description: "New description", hidden: false })
    }),
  )

  it.effect("removes a transform when its scope closes", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("scoped")
      const scope = yield* Scope.make()
      yield* agent.transform((editor) => editor.update(id, () => {})).pipe(Scope.provide(scope))
      expect(yield* agent.get(id)).toBeDefined()

      yield* Scope.close(scope, Exit.void)
      expect(yield* agent.get(id)).toBeUndefined()
    }),
  )

  it.effect("applies direct agent updates", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("build")

      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.mode = "primary"
          info.hidden = true
        }),
      )

      expect(yield* agent.get(id)).toMatchObject({ id, mode: "primary", hidden: true })
    }),
  )

  it.effect("creates agents with runtime defaults and supports direct removal", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("custom")

      yield* agent.transform((editor) => editor.update(id, () => {}))
      expect(yield* agent.get(id)).toEqual(AgentV2.Info.empty(id))

      yield* agent.transform((editor) => editor.remove(id))
      expect(yield* agent.get(id)).toBeUndefined()
    }),
  )

  it.effect("does not ambiently opt built-in agents into bash", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
        ),
      )

      const agents = yield* agent.all()
      expect(agents.map((item) => String(item.id)).sort()).toEqual([
        "build",
        "compaction",
        "explore",
        "general",
        "plan",
        "summary",
        "title",
      ])
      for (const item of agents) {
        expect(item.permissions.some((rule) => rule.action === "bash" && rule.effect !== "deny")).toBe(false)
      }
    }),
  )

  // kilocode_change start - the explore agent must keep the shared secret-file read prompt
  it.effect("keeps the secret file read prompt for every built-in agent", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
        ),
      )

      for (const id of ["build", "plan", "general", "explore"]) {
        const info = yield* agent.get(AgentV2.ID.make(id))
        expect(info).toBeDefined()
        if (!info) throw new Error(`missing built-in agent ${id}`)
        expect(PermissionV2.evaluate("read", "project/.env", info.permissions).effect).toBe("ask")
        expect(PermissionV2.evaluate("read", "project/.env.local", info.permissions).effect).toBe("ask")
        expect(PermissionV2.evaluate("read", "project/.env.example", info.permissions).effect).toBe("allow")
        expect(PermissionV2.evaluate("read", "project/src/index.ts", info.permissions).effect).toBe("allow")
      }

      for (const id of ["compaction", "title", "summary"]) {
        const info = yield* agent.get(AgentV2.ID.make(id))
        expect(info).toBeDefined()
        if (!info) throw new Error(`missing built-in agent ${id}`)
        expect(PermissionV2.evaluate("read", "project/.env", info.permissions).effect).toBe("deny")
      }
    }),
  )

  it.effect("treats case variants of the secret file rules as matched on darwin", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
        ),
      )

      yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          const original = Object.getOwnPropertyDescriptor(process, "platform")
          Object.defineProperty(process, "platform", { ...original, value: "darwin" })
          return original
        }),
        () =>
          Effect.gen(function* () {
            for (const id of ["build", "plan", "general", "explore"]) {
              const info = yield* agent.get(AgentV2.ID.make(id))
              expect(info).toBeDefined()
              if (!info) throw new Error(`missing built-in agent ${id}`)
              // A case-insensitive volume resolves every spelling below to the file the rule names.
              expect(PermissionV2.evaluate("read", "project/.ENV", info.permissions).effect).toBe("ask")
              expect(PermissionV2.evaluate("read", "project/.Env", info.permissions).effect).toBe("ask")
              expect(PermissionV2.evaluate("read", "project/.ENV.LOCAL", info.permissions).effect).toBe("ask")
              expect(PermissionV2.evaluate("read", "project/.ENV.EXAMPLE", info.permissions).effect).toBe("allow")
            }
          }),
        (original) =>
          Effect.sync(() => {
            if (original) Object.defineProperty(process, "platform", original)
          }),
      )
    }),
  )
  // kilocode_change end
})
