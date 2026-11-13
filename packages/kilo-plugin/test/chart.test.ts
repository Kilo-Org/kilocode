import { afterEach, describe, expect, test } from "bun:test"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Tool } from "@opencode/core/tool"
import type { SkillEditor } from "@opencode/plugin/effect/skill"
import type { Skill } from "@opencode/schema/skill"
import type { Tool as ToolSchema } from "@opencode/schema/tool"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer } from "effect"
import { location } from "../../core/test/fixture/location"
import { registerToolPlugin, toolDefinitions } from "../../core/test/lib/tool"
import { KiloChartPlugin } from "../src/chart"
import { makeTool } from "../src/chart/tool"

const context = {
  sessionID: "ses_chart",
  agent: "build",
  messageID: "msg_chart",
  id: "call_chart",
  progress: () => Effect.void,
} as unknown as Parameters<ToolSchema.Info["execute"]>[1]

const saved = { ...process.env }

afterEach(() => {
  process.env = { ...saved }
})

function client(value: string | undefined) {
  if (value === undefined) delete process.env.OPENCODE_CLIENT
  else process.env.OPENCODE_CLIENT = value
}

const bar = JSON.stringify({ type: "bar", data: { labels: ["A", "B"], datasets: [{ data: [1, 2] }] } })

describe("chart tool", () => {
  const run = (params: { title: string; description?: string; spec: string }) =>
    Effect.runPromise(makeTool().execute(params, context))

  test("returns an actionable message when the spec is not JSON", async () => {
    const result = await run({ title: "Revenue", spec: "bar chart" })
    expect(result.output).toStartWith("Invalid chart spec: could not parse JSON.")
    expect(result.output).toContain("mermaid")
    expect(result.metadata).toEqual({ title: "Revenue", description: undefined, error: "invalid-json" })
  })

  test("returns an actionable message when the config lacks type or data", async () => {
    const result = await run({ title: "Revenue", description: "Q1", spec: JSON.stringify({ options: {} }) })
    expect(result.output).toStartWith('Invalid chart spec: must be a Chart.js v4 config with "type" and "data" fields.')
    expect(result.metadata).toEqual({ title: "Revenue", description: "Q1", error: "invalid-spec" })
  })

  test("treats a JSON null as a config without type and data", async () => {
    const result = await run({ title: "Revenue", spec: "null" })
    expect(result.metadata).toMatchObject({ error: "invalid-spec" })
  })

  test("remaps an area chart to a filled line chart on every dataset", async () => {
    const result = await run({
      title: "Users",
      spec: JSON.stringify({
        type: "area",
        data: {
          labels: ["Jan", "Feb"],
          datasets: [{ data: [1, 2] }, { data: [3, 4], fill: false, borderColor: "#fff" }],
        },
      }),
    })
    expect(JSON.parse(result.output as string)).toEqual({
      type: "line",
      data: {
        labels: ["Jan", "Feb"],
        datasets: [
          { fill: true, data: [1, 2] },
          // The dataset keeps its own fill and colors: the remap only sets the default.
          { fill: false, data: [3, 4], borderColor: "#fff" },
        ],
      },
    })
    expect(result.metadata).toEqual({ title: "Users", description: undefined })
  })

  test("round-trips a supported config as JSON", async () => {
    const result = await run({ title: "Revenue", description: "Q1", spec: bar })
    expect(result.output).toBe(bar)
    expect(result.metadata).toEqual({ title: "Revenue", description: "Q1" })
  })
})

// The tool is registered on the real tool registry, so the test covers the same visibility path a session uses.
function registry(value: string | undefined) {
  client(value)
  const skills = new Array<Skill.Info>()
  const skill = {
    list: () => Effect.die("unused skill.list"),
    transform: (callback: (editor: SkillEditor) => void) =>
      Effect.sync(() => {
        callback({
          list: () => skills,
          get: (id) => skills.find((entry) => entry.id === id),
          add: (entry) => {
            skills.push(entry)
          },
          update: () => {},
          remove: () => {},
        })
      }).pipe(Effect.as({ dispose: Effect.void })),
    reload: () => Effect.void,
  }
  const layer = AppNodeBuilder.build(
    LayerNode.group([
      Tool.node,
      makeLocationNode({
        name: "test/kilo-chart-plugin",
        layer: Layer.effectDiscard(registerToolPlugin(KiloChartPlugin, { skill })),
        deps: [Tool.node],
      }),
    ]),
    [
      Config.node.replace(Config.testLayer()),
      Location.node.replace(
        Layer.succeed(
          Location.Service,
          Location.Service.of({
            ...location({ directory: AbsolutePath.make("/workspace") }),
            project: {
              id: Project.ID.global,
              directory: AbsolutePath.make("/workspace"),
              canonical: AbsolutePath.make("/workspace"),
            },
          }),
        ),
      ),
    ],
  )
  const run = Effect.gen(function* () {
    const registry = yield* Tool.Service
    return {
      tools: (yield* toolDefinitions(registry)).map((tool) => tool.name),
      skills: skills.map((entry) => String(entry.id)),
    }
  })
  return Effect.runPromise(run.pipe(Effect.scoped, Effect.provide(layer)))
}

describe("chart client gating", () => {
  test("registers the tool and its skill for the VS Code client", async () => {
    const result = await registry("vscode")
    expect(result.tools).toContain("chart")
    expect(result.skills).toEqual(["chart"])
  })

  for (const value of ["cli", "jetbrains", undefined])
    test(`registers nothing for the ${value ?? "unset"} client`, async () => {
      const result = await registry(value)
      expect(result.tools).not.toContain("chart")
      expect(result.skills).toEqual([])
    })
})
