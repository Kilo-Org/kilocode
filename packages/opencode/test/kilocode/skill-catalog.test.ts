// kilocode_change - new file
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { expect } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { Permission } from "../../src/permission"
import { SystemPrompt } from "../../src/session/system"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "../../src/tool/registry"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([ToolRegistry.node, SystemPrompt.node, CrossSpawnSpawner.node, Ripgrep.node])),
)

const agent = {
  name: "build",
  mode: "primary" as const,
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

function count(text: string, value: string) {
  return text.split(value).length - 1
}

it.instance("exposes the available skill catalog once in model context", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const dir = path.join(instance.directory, ".kilo", "skill", "catalog-skill")
    yield* Effect.promise(() => fs.mkdir(dir, { recursive: true }))
    yield* Effect.promise(() =>
      Bun.write(
        path.join(dir, "SKILL.md"),
        [
          "---",
          "name: catalog-skill",
          "description: Catalog skill for deduplication tests.",
          "---",
          "",
          "# Catalog Skill",
          "",
          "Full skill instructions stay out of model-facing metadata.",
          "",
        ].join("\n"),
      ),
    )

    const system = yield* SystemPrompt.Service
    const registry = yield* ToolRegistry.Service
    const prompt = yield* system.skills(agent)
    if (!prompt) throw new Error("skill catalog was not added to the system prompt")
    const tool = (yield* registry.tools({
      providerID: ProviderV2.ID.opencode,
      modelID: ModelV2.ID.make("gpt-5"),
      agent,
    })).find((item) => item.id === SkillTool.id)
    if (!tool) throw new Error("skill tool was not returned")

    const context = [prompt, tool.description].join("\n")
    expect(count(prompt, "<available_skills>")).toBe(1)
    expect(count(context, "<available_skills>")).toBe(1)
    expect(context).toContain("<name>catalog-skill</name>")
    expect(context).not.toContain("# Catalog Skill")
    expect(tool.description).toContain("skills listed in the system prompt")
  }),
)
