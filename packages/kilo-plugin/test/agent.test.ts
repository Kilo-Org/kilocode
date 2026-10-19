import { describe, expect } from "bun:test"
import path from "path"
import { DateTime, Effect, PubSub, Schema, Stream } from "effect"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigAgentPlugin } from "@opencode/core/config/plugin/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Permission } from "@opencode/core/permission"
import { AgentPlugin } from "@opencode/core/plugin/agent"
import { PlanPlugin } from "@opencode/core/plugin/plan"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { Document, Info } from "@opencode/schema/config"
import { Event } from "@opencode/schema/event"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { agentHost, host } from "../../core/test/plugin/host"
import { testEffect } from "../../core/test/lib/effect"
import { KiloAgentPlugin } from "../src/agent"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Agent.node, Bus.node, FSUtil.node, Global.node])))

const hooks = {
  hook: () => Effect.succeed({ dispose: Effect.void }),
}

const sessionID = Session.ID.make("ses_kilo_agent_test")

/** Runs the native agent and Plan plugins, then the Kilo plugin, in the built-in order. */
const setup = Effect.fnUntraced(function* () {
  const agents = yield* Agent.Service
  const events = yield* PubSub.unbounded<SessionEvent.AgentSelected>()
  const persisted = new Array<string>()
  const context = host({
    agent: agentHost(agents),
    tool: { ...host().tool, ...hooks },
    event: { subscribe: () => Stream.fromPubSub(events) },
    session: {
      ...hooks,
      synthetic: (input) => {
        persisted.push(input.text)
        return Effect.succeed(
          SessionInbox.Synthetic.make({
            id: SessionMessage.ID.make("msg_kilo_agent_test"),
            sessionID,
            time: { created: DateTime.makeUnsafe(0) },
            type: "synthetic",
            payload: { text: input.text },
            delivery: "steer",
          }),
        )
      },
    },
  })
  yield* AgentPlugin.Plugin.effect(context)
  yield* PlanPlugin.Plugin.effect(context)
  yield* KiloAgentPlugin.Plugin.effect(context)
  return { agents, context, events, persisted }
})

/**
 * Runs the config agent plugin, then a later post plugin that appends a rule to every agent (as the browser
 * plugin does), then the Kilo ceiling, which the host registers after the internal post plugins.
 */
const configure = Effect.fnUntraced(function* (info: unknown) {
  const result = yield* setup()
  yield* ConfigAgentPlugin.Plugin.effect(result.context).pipe(
    Effect.provide(Config.testLayer([new Document({ type: "document", info: Schema.decodeUnknownSync(Info)(info) })])),
  )
  yield* result.agents.transform((editor) =>
    editor.list().forEach((agent) => editor.update(agent.id, (item) => item.permissions.push({ ...browser }))),
  )
  yield* KiloAgentPlugin.Ceiling.effect(result.context)
  return result
})

const browser = { action: "browser", resource: "*", effect: "deny" } as const

const selected = (agent: string, previous?: string): SessionEvent.AgentSelected => ({
  id: Event.ID.create(),
  created: 0,
  durable: { aggregateID: sessionID, seq: Event.Seq.make(0), version: Event.Version.make(1) },
  type: "session.agent.selected",
  data: {
    sessionID,
    agent: Agent.ID.make(agent),
    ...(previous === undefined ? {} : { previous: Agent.ID.make(previous) }),
  },
})

const settle = (persisted: ReadonlyArray<string>, expected: number, remaining = 1000): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (persisted.length >= expected) return
    if (remaining === 0) return yield* Effect.fail(new Error(`saw ${persisted.length} of ${expected} reminders`))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* settle(persisted, expected, remaining - 1)
  })

/** Waits until the plugin persisted the expected number of agent-switch reminders. */
const switches = (
  persisted: ReadonlyArray<string>,
  expected: number,
  remaining = 1000,
): Effect.Effect<string[], Error> =>
  Effect.gen(function* () {
    const found = persisted.filter((text) => text.includes("The active agent has changed"))
    if (found.length >= expected) return found
    if (remaining === 0) return yield* Effect.fail(new Error(`saw ${found.length} of ${expected} reminders`))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* switches(persisted, expected, remaining - 1)
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
      expect(effect("skill", "review")).toBe("allow")
      expect(effect("external_directory", path.join(global.data, "tool-output", "*"))).toBe("allow")
      expect(effect("external_directory", "/outside/*")).toBe("deny")
    }),
  )

  it.effect("lets Orchestrator delegate but not run shell commands or edit", () =>
    Effect.gen(function* () {
      yield* setup()
      const rules = yield* permissions("orchestrator")
      expect(Permission.evaluate("subagent", "general", rules).effect).toBe("allow")
      expect(Permission.evaluate("skill", "review", rules).effect).toBe("allow")
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
      expect(effect("skill", "review")).toBe("allow")
      expect(effect("unknown_plugin_tool", "*")).toBe("deny")
    }),
  )

  it.effect("lets user agents with a built-in ID override the built-in", () =>
    Effect.gen(function* () {
      const { agents } = yield* configure({
        // v1 resolved `build` to `code`. The hidden build copy is never the default, so Code is.
        default_agent: "build",
        agents: {
          // v1 kept `agent.<id>.permission` as the opt-in for one read-only agent.
          ask: { system: "Custom ask.", permissions: [{ action: "edit", resource: "*", effect: "allow" }] },
          debug: { disabled: true },
        },
      })
      const ask = yield* agents.get(Agent.ID.make("ask"))
      expect(ask?.system).toBe("Custom ask.")
      expect(ask?.description).toBe("Get answers and explanations without making changes to the codebase.")
      expect(Permission.evaluate("edit", "src/index.ts", ask?.permissions ?? []).effect).toBe("allow")
      expect(yield* agents.get(Agent.ID.make("debug"))).toBeUndefined()
      expect((yield* agents.select()).id).toBe(Agent.ID.make("code"))
    }),
  )

  it.effect("keeps read-only limits when global config rules allow more", () =>
    Effect.gen(function* () {
      const global = yield* Global.Service
      const { agents } = yield* configure({
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "shell", resource: "*", effect: "allow" },
          { action: "skill", resource: "*", effect: "ask" },
          { action: "read", resource: "secrets/*", effect: "deny" },
        ],
        agents: { plan: { permissions: [{ action: "shell", resource: "cargo search *", effect: "allow" }] } },
      })
      const effect = (id: string, action: string, resource: string) =>
        Effect.map(
          agents.get(Agent.ID.make(id)),
          (agent) => Permission.evaluate(action, resource, agent?.permissions ?? []).effect,
        )
      for (const id of ["ask", "plan"]) {
        expect(yield* effect(id, "edit", "src/index.ts")).toBe("deny")
        expect(yield* effect(id, "shell", "rm -rf src")).toBe("deny")
        expect(yield* effect(id, "subagent", "general")).toBe("deny")
        expect(yield* effect(id, "unknown_plugin_tool", "*")).toBe("deny")
        // Global rules still tune the guard's own tools and keep their denies.
        expect(yield* effect(id, "skill", "review")).toBe("ask")
        expect(yield* effect(id, "read", "secrets/key")).toBe("deny")
        expect(yield* effect(id, "read", "src/index.ts")).toBe("allow")
      }
      expect(yield* effect("ask", "shell", "cargo search serde")).toBe("deny")
      expect(yield* effect("plan", "shell", "cargo search serde")).toBe("allow")
      expect(yield* effect("plan", "edit", path.join(global.home, ".opencode", "plan", "cache.md"))).toBe("allow")
      expect(yield* effect("orchestrator", "shell", "ls")).toBe("deny")
      expect(yield* effect("code", "shell", "rm -rf src")).toBe("allow")
      // A rule a later post plugin appends to every agent stays in place after the ceiling.
      for (const id of ["ask", "plan", "orchestrator", "code"]) expect(yield* effect(id, "browser", "*")).toBe("deny")
      expect((yield* agents.list()).map((agent) => agent.id)).not.toContain(Agent.ID.make("kilo-config-permissions"))
    }),
  )

  it.effect("adds one agent-switch reminder per switch with the v1 capability line", () =>
    Effect.gen(function* () {
      const { agents, events, persisted } = yield* setup()
      // A user agent added after the built-ins, as the config plugins do.
      yield* agents.transform((editor) => editor.update(Agent.ID.make("reviewer"), () => {}))
      for (const event of [
        selected("ask"),
        selected("code", "code"),
        selected("ask", "code"),
        selected("code", "ask"),
        selected("plan", "code"),
        selected("reviewer", "plan"),
      ])
        yield* PubSub.publish(events, event)
      const found = yield* switches(persisted, 4)
      expect(found).toEqual([
        "<system-reminder>\nThe active agent has changed from Code to Ask.\nThis supersedes earlier agent-switch reminders. Your instructions and permissions are those of the Ask agent as given in the current system prompt; earlier turns reflect the previous agent, not your current capabilities.\nThis agent cannot modify files or run mutating commands. If a request needs implementation, suggest switching to an agent that can.\n</system-reminder>",
        expect.stringContaining(
          "changed from Ask to Code.\nThis supersedes earlier agent-switch reminders. Your instructions and permissions are those of the Code agent as given in the current system prompt; earlier turns reflect the previous agent, not your current capabilities.\nThis agent may modify files and run commands within its configured permissions.",
        ),
        expect.stringContaining("changed from Code to Plan.\nThis supersedes earlier"),
        expect.stringContaining(
          "changed from Plan to reviewer.\nThis supersedes earlier agent-switch reminders. Your instructions and permissions are those of the reviewer agent as given in the current system prompt; earlier turns reflect the previous agent, not your current capabilities.\nUse the tools according to this agent's configured permissions; the permission system reports what is allowed.",
        ),
      ])
      expect(found[2]).toContain("This agent cannot modify files")
      // The native Plan plugin adds its own enter reminder on the same switch, as v1 sent both.
      yield* settle(persisted, 6)
      expect(persisted.filter((text) => text.includes("changed from Code to Plan"))).toHaveLength(1)
      expect(persisted.filter((text) => text.includes("You are in Plan mode"))).toHaveLength(1)
    }),
  )
})
