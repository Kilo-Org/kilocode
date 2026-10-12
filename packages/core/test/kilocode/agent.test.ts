import { describe, expect } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigAgentPlugin } from "@opencode/core/config/plugin/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { KiloAgentPlugin } from "@opencode/core/kilocode/agent"
import { Permission } from "@opencode/core/permission"
import { AgentPlugin } from "@opencode/core/plugin/agent"
import { PlanPlugin } from "@opencode/core/plugin/plan"
import { Document, Info } from "@opencode/schema/config"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Schema } from "effect"
import { testEffect } from "../lib/effect"
import { agentHost, host } from "../plugin/host"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Agent.node, Bus.node, FSUtil.node, Global.node])))

const hooks = {
  hook: () => Effect.succeed({ dispose: Effect.void }),
}

/** Runs the native agent and Plan plugins, then the Kilo plugin, in the built-in order. */
const setup = Effect.fnUntraced(function* () {
  const agents = yield* Agent.Service
  const context = host({
    agent: agentHost(agents),
    tool: { ...host().tool, ...hooks },
    session: hooks,
  })
  yield* AgentPlugin.Plugin.effect(context)
  yield* PlanPlugin.Plugin.effect(context)
  yield* KiloAgentPlugin.Plugin.effect(context)
  return { agents, context }
})

const permissions = Effect.fnUntraced(function* (id: string) {
  const agent = yield* (yield* Agent.Service).get(Agent.ID.make(id))
  if (!agent) throw new Error(`expected agent: ${id}`)
  return agent.permissions
})

describe("KiloAgentPlugin", () => {
  it.effect("ships the v1 agent set with Code as the default and the v1 cycle order", () =>
    Effect.gen(function* () {
      const { agents } = yield* setup()
      const list = yield* agents.list()
      expect(list.filter((agent) => agent.mode !== "subagent" && !agent.hidden).map((agent) => agent.id)).toEqual(
        ["code", "ask", "debug", "orchestrator", "plan"].map((id) => Agent.ID.make(id)),
      )
      // `build` stays as a hidden copy of Code for callers that still name it.
      expect(yield* agents.get(Agent.ID.make("build"))).toMatchObject({ name: "Code", hidden: true })
      expect((yield* agents.select()).id).toBe(Agent.ID.make("code"))
      expect(yield* agents.get(Agent.ID.make("code"))).toMatchObject({
        name: "Code",
        description: "The default agent. Executes tools based on configured permissions.",
        mode: "primary",
      })
      expect((yield* agents.get(Agent.ID.make("ask")))?.system).toContain("You are in Ask mode")
      expect((yield* agents.get(Agent.ID.make("debug")))?.system).toContain("expert software debugger")
      expect((yield* agents.get(Agent.ID.make("orchestrator")))?.system).toContain("use the subagent tool")
    }),
  )

  it.effect("asks before shell commands that are not read-only for Code, Debug and General", () =>
    Effect.gen(function* () {
      yield* setup()
      for (const id of ["code", "build", "debug", "general"]) {
        const rules = yield* permissions(id)
        expect(Permission.evaluate("shell", "ls -la", rules).effect).toBe("allow")
        expect(Permission.evaluate("shell", "mkdir build", rules).effect).toBe("allow")
        expect(Permission.evaluate("shell", "rm -rf build", rules).effect).toBe("ask")
      }
      expect(Permission.evaluate("edit", "src/index.ts", yield* permissions("code")).effect).toBe("allow")
      expect(Permission.evaluate("edit", "src/index.ts", yield* permissions("debug")).effect).toBe("allow")
    }),
  )

  it.effect("keeps Ask read-only", () =>
    Effect.gen(function* () {
      yield* setup()
      const global = yield* Global.Service
      const rules = yield* permissions("ask")
      const effect = (action: string, resource: string) => Permission.evaluate(action, resource, rules).effect
      expect(effect("edit", "src/index.ts")).toBe("deny")
      expect(effect("subagent", "general")).toBe("deny")
      expect(effect("unknown_plugin_tool", "*")).toBe("deny")
      expect(effect("shell", "git log -5")).toBe("allow")
      expect(effect("shell", "gh pr view 1")).toBe("allow")
      expect(effect("shell", "gh pr merge 1")).toBe("ask")
      expect(effect("shell", "git push")).toBe("deny")
      expect(effect("shell", "rm -rf src")).toBe("deny")
      expect(effect("shell", "cat a > b")).toBe("deny")
      expect(effect("shell", "rg --pre ./run x")).toBe("deny")
      expect(effect("read", "src/index.ts")).toBe("allow")
      expect(effect("read", ".env")).toBe("ask")
      expect(effect("read", ".env.example")).toBe("allow")
      expect(effect("question", "*")).toBe("allow")
      expect(effect("external_directory", path.join(global.data, "tool-output", "*"))).toBe("allow")
      expect(effect("external_directory", "/outside/*")).toBe("deny")
    }),
  )

  it.effect("lets Orchestrator delegate but not run shell commands or edit", () =>
    Effect.gen(function* () {
      yield* setup()
      const rules = yield* permissions("orchestrator")
      expect(Permission.evaluate("subagent", "general", rules).effect).toBe("allow")
      expect(Permission.evaluate("shell", "ls", rules).effect).toBe("deny")
      expect(Permission.evaluate("edit", "src/index.ts", rules).effect).toBe("deny")
    }),
  )

  it.effect("limits Plan to read-only tools and the native Plan directory", () =>
    Effect.gen(function* () {
      yield* setup()
      const global = yield* Global.Service
      const directory = path.join(global.home, ".opencode", "plan")
      const rules = yield* permissions("plan")
      const effect = (action: string, resource: string) => Permission.evaluate(action, resource, rules).effect
      expect(effect("edit", "src/index.ts")).toBe("deny")
      expect(effect("edit", path.join(directory, "cache.md"))).toBe("allow")
      expect(effect("external_directory", path.join(directory, "*"))).toBe("allow")
      expect(effect("shell", "git diff")).toBe("allow")
      expect(effect("shell", "npm install")).toBe("deny")
      expect(effect("subagent", "explore")).toBe("allow")
      expect(effect("subagent", "general")).toBe("deny")
      expect(effect("unknown_plugin_tool", "*")).toBe("deny")
    }),
  )

  it.effect("lets user agents with a built-in ID override the built-in", () =>
    Effect.gen(function* () {
      const { agents, context } = yield* setup()
      const decode = Schema.decodeUnknownSync(Info)
      yield* ConfigAgentPlugin.Plugin.effect(context).pipe(
        Effect.provide(
          Config.testLayer([
            new Document({
              type: "document",
              info: decode({
                agents: {
                  ask: { system: "Custom ask.", permissions: [{ action: "edit", resource: "*", effect: "allow" }] },
                  debug: { disabled: true },
                },
              }),
            }),
          ]),
        ),
      )
      const ask = yield* agents.get(Agent.ID.make("ask"))
      expect(ask?.system).toBe("Custom ask.")
      expect(ask?.description).toBe("Get answers and explanations without making changes to the codebase.")
      expect(Permission.evaluate("edit", "src/index.ts", ask?.permissions ?? []).effect).toBe("allow")
      expect(yield* agents.get(Agent.ID.make("debug"))).toBeUndefined()
    }),
  )
})
