import { describe, expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer } from "effect"
import { location } from "../../core/test/fixture/location"
import { testEffect } from "../../core/test/lib/effect"
import { KiloBrowserToolPlugin } from "../src/browser"

// The plugin only registers while the host passes its broker, and it reads that endpoint once.
process.env.KILO_BROWSER_BROKER_URL = "http://127.0.0.1:41234"
process.env.KILO_BROWSER_BROKER_TOKEN = "secret"

const session = Session.ID.make("ses_browser")

const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, SessionStore.node, PermissionSaved.node, Agent.node, PluginHooks.node, Permission.node]),
    [Location.node.replace(current)],
  ),
)

const request = (resource: string) => ({
  id: Permission.ID.create(`per_browser_${resource}`),
  sessionID: session,
  action: "browser_open",
  resources: [resource],
  save: [resource],
})

/** Builds the allow-all agent the built-in policy gives every tool, and registers the plugin's hook. */
function setup(rules: Permission.Ruleset = [{ action: "*", resource: "*", effect: "allow" }]) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: session,
        project_id: Project.ID.global,
        slug: session,
        directory: "/project",
        title: session,
        version: "test",
        agent: Agent.ID.make("test"),
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const agents = yield* Agent.Service
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("test"), (agent) => {
        agent.permissions = [...rules]
      }),
    )
    const hooks = yield* PluginHooks.Service
    const context = {
      location: { directory: "/project" },
      permission: { hook: (name: "evaluate", callback: never) => hooks.register("permission", name, callback) },
      tool: { transform: () => Effect.void },
    }
    yield* KiloBrowserToolPlugin.effect(context as never)
  })
}

describe("browser_open permission request", () => {
  it.effect("saves the origin and offers every site as the broader rule", () =>
    Effect.gen(function* () {
      const asked: unknown[] = []
      const tools: Array<{ execute: (params: { url: string }, context: unknown) => Effect.Effect<unknown, unknown> }> =
        []
      const context = {
        location: { directory: "/project" },
        permission: {
          hook: () => Effect.void,
          // Decline, so the test stops before the tool calls the broker.
          assert: (input: unknown) =>
            Effect.sync(() => asked.push(input)).pipe(Effect.andThen(Effect.fail("declined"))),
        },
        tool: {
          transform: (edit: (editor: unknown) => void) =>
            Effect.sync(() => edit({ add: (tool: never) => tools.push(tool) })),
        },
      }
      yield* KiloBrowserToolPlugin.effect(context as never)
      yield* tools[0]
        .execute(
          { url: "http://0.0.0.0:3000/app" },
          { sessionID: session, agent: "test", messageID: "msg", id: "call" },
        )
        .pipe(Effect.exit)
      expect(asked).toEqual([
        {
          action: "browser_open",
          resources: ["navigate:http://localhost:3000"],
          save: ["navigate:http://localhost:3000"],
          sessionID: session,
          agent: "test",
          metadata: {
            operation: "open",
            url: "http://localhost:3000/app",
            rules: ["navigate:http://localhost:3000", "navigate:*"],
          },
          source: { type: "tool", messageID: "msg", id: "call" },
        },
      ])
    }),
  )
})

describe("browser_open permission through the permission service", () => {
  it.effect("asks under the built-in allow-all policy", () =>
    Effect.gen(function* () {
      yield* setup()
      const service = yield* Permission.Service
      expect(yield* service.ask(request("navigate:https://example.com"))).toMatchObject({ effect: "ask" })
    }),
  )

  it.effect("allows the origin a saved approval names", () =>
    Effect.gen(function* () {
      yield* setup()
      const service = yield* Permission.Service
      const saved = yield* PermissionSaved.Service
      yield* saved.add({
        projectID: Project.ID.global,
        action: "browser_open",
        resources: ["navigate:https://example.com"],
      })
      expect(yield* service.ask(request("navigate:https://example.com"))).toMatchObject({ effect: "allow" })
      expect(yield* service.ask(request("navigate:https://kilo.ai"))).toMatchObject({ effect: "ask" })
    }),
  )
})
