import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"
import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { parse } from "jsonc-parser"
import path from "path"
import { Permission } from "../../src/permission"
import { MessageID, SessionID } from "../../src/session/schema"
import { SystemPrompt } from "../../src/session/system"
import { Skill } from "../../src/skill"
import { ToolRegistry } from "../../src/tool/registry"
import { SkillTool } from "../../src/tool/skill"
import type { Tool } from "../../src/tool/tool"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([Skill.node, ToolRegistry.node, SystemPrompt.node, CrossSpawnSpawner.node, Ripgrep.node]),
  ),
)

const agent = {
  name: "code",
  mode: "primary" as const,
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  agent: agent.name,
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const guides = {
  "kilo-config": ["# Kilo CLI Configuration Reference", "KILO_DISABLE_PROJECT_CONFIG", "%ProgramData%\\kilo\\"],
  "kilo-customization": [
    "# Kilo Commands, Agents, and Skills",
    "Finding a named command",
    "Project workflows override",
  ],
  "kilo-tools": ["# Kilo Tool Permissions and MCP Servers", "last matching rule wins", '"external_directory": "deny"'],
  "kilo-agent-manager": [
    "# Agent Manager Setup And Run Scripts",
    "Do not use `git stash` or autostash",
    "should not be edited to configure run/setup behavior",
  ],
  "kilo-tui": [
    "# Kilo TUI Settings (Ctrl+P Command Palette)",
    "the agent cannot change them programmatically",
    "There is no notification slash command or command-palette toggle",
  ],
}

function loader() {
  return Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const tool = (yield* registry.tools({
      providerID: ProviderV2.ID.opencode,
      modelID: ModelV2.ID.make("gpt-5"),
      agent,
    })).find((item) => item.id === SkillTool.id)
    if (!tool) throw new Error("skill tool was not returned")
    return tool
  })
}

it.instance("discovers focused built-in guides without loading their bodies into model context", () =>
  Effect.gen(function* () {
    const skills = yield* Skill.Service
    const system = yield* SystemPrompt.Service
    const prompt = yield* system.skills(agent)
    if (!prompt) throw new Error("skill catalog was not added to the system prompt")
    const tool = yield* loader()
    const context = [prompt, tool.description].join("\n")

    for (const [name, markers] of Object.entries(guides)) {
      const info = yield* skills.require(name)
      expect(info.location).toBe(Skill.BUILTIN_LOCATION)
      expect(prompt).toContain(`<name>${name}</name>`)
      expect(prompt).toContain(`<description>${info.description}</description>`)
      for (const marker of markers) expect(context).not.toContain(marker)
    }
  }),
)

it.instance("loads each routed guide separately without a filesystem base directory", () =>
  Effect.gen(function* () {
    const skills = yield* Skill.Service
    const tool = yield* loader()
    for (const [name, markers] of Object.entries(guides)) {
      const result = yield* tool.execute({ name }, ctx)
      expect(result.metadata.dir).toBe(Skill.BUILTIN_LOCATION)
      expect(result.output).toContain(`<skill_content name="${name}">`)
      expect(result.output).not.toContain("Base directory for this skill")
      expect(result.output).not.toContain("<skill_files>")
      for (const marker of markers) expect(result.output).toContain(marker)
      for (const [other, markers] of Object.entries(guides)) {
        if (other === name) continue
        expect(result.output).not.toContain(markers.at(0)!)
      }

      const routes = Array.from(result.output.matchAll(/skill\(\{ name: "([^"]+)" \}\)/g), (match) => match.at(1)!)
      if (name === "kilo-config") {
        expect(routes.toSorted()).toEqual(
          Object.keys(guides)
            .filter((name) => name !== "kilo-config")
            .toSorted(),
        )
      }
      for (const route of routes) {
        expect((yield* skills.require(route)).location).toBe(Skill.BUILTIN_LOCATION)
      }
    }
  }),
)

it.instance("permission example keeps specific edit rules after the fallback", () =>
  Effect.gen(function* () {
    const tool = yield* loader()
    const result = yield* tool.execute({ name: "kilo-tools" }, ctx)
    const example = result.output.match(/```jsonc\n([\s\S]+?)\n```/)?.at(1)
    if (!example) throw new Error("permission example was not loaded")
    const cfg = Schema.decodeUnknownSync(Schema.Struct({ permission: ConfigPermissionV1.Info }))(parse(example))
    const rules = Permission.fromConfig(cfg.permission)
    expect(Permission.evaluate("edit", "src/app.ts", rules).action).toBe("allow")
    expect(Permission.evaluate("edit", "package.lock", rules).action).toBe("deny")
    expect(Permission.evaluate("edit", "README.md", rules).action).toBe("ask")
    expect(Permission.evaluate("external_directory", "/tmp", rules).action).toBe("deny")
  }),
)

for (const name of ["kilo-config", "kilo-customization"]) {
  it.instance(`user override of ${name} wins in discovery and tool loading`, () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const dir = path.join(instance.directory, ".kilo", "skills", name)
      yield* Effect.promise(() =>
        Bun.write(
          path.join(dir, "SKILL.md"),
          `---\nname: ${name}\ndescription: Local guide for ${name}.\n---\n\nLocal instructions instead of the built-in guide.\n`,
        ),
      )

      const skills = yield* Skill.Service
      const system = yield* SystemPrompt.Service
      const info = yield* skills.require(name)
      expect(info.location).toBe(path.join(dir, "SKILL.md"))
      const prompt = yield* system.skills(agent)
      expect(prompt).toContain(`<description>Local guide for ${name}.</description>`)
      expect(prompt?.split(`<name>${name}</name>`)).toHaveLength(2)

      const tool = yield* loader()
      const result = yield* tool.execute({ name }, ctx)
      expect(result.metadata.dir).toBe(dir)
      expect(result.output).toContain("Local instructions instead of the built-in guide.")
      for (const markers of Object.values(guides)) expect(result.output).not.toContain(markers.at(0)!)
      expect((yield* skills.require("kilo-tools")).location).toBe(Skill.BUILTIN_LOCATION)
    }),
  )
}
