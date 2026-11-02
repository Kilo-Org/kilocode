import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Image } from "@opencode/core/image"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { testEffect } from "../../core/test/lib/effect"
import { imagePassthrough } from "../../core/test/lib/image"
import { permissionLayer } from "../../core/test/lib/permission"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "../../core/test/lib/tool"
import { KiloChartToolPlugin, normalizeChartSpec } from "../src/tool-chart"

const sessionID = Session.ID.make("ses_kilo_tool_chart_test")

const node = (app: string) =>
  makeLocationNode({
    name: "test/kilo-tool-chart-plugin",
    layer: Layer.effectDiscard(
      registerToolPlugin(KiloChartToolPlugin, { app: { name: app, version: "test", channel: "test" } }),
    ),
    deps: [Tool.node],
  })

const layer = (app: string) =>
  AppNodeBuilder.build(LayerNode.group([Tool.node, node(app)]), [
    Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
    Image.node.replace(imagePassthrough),
  ])
const vscode = testEffect(layer("vscode"))
const cli = testEffect(layer("cli"))

const revenue = {
  type: "bar",
  data: { labels: ["Jan", "Feb"], datasets: [{ label: "Revenue", data: [12, 19] }] },
}

const run = (tools: Tool.Interface, input: Record<string, unknown>) =>
  executeTool(tools, {
    sessionID,
    ...toolIdentity,
    call: { type: "tool-call", id: "call-chart", name: "chart", input },
  })

vscode.effect("registers the chart tool for the VS Code client", () =>
  Effect.gen(function* () {
    const tools = yield* Tool.Service
    expect((yield* toolDefinitions(tools)).map((tool) => tool.name)).toContain("chart")
  }),
)

cli.effect("does not register the chart tool for other clients", () =>
  Effect.gen(function* () {
    const tools = yield* Tool.Service
    expect((yield* toolDefinitions(tools)).map((tool) => tool.name)).not.toContain("chart")
  }),
)

vscode.effect("returns the chart spec as the model-facing content", () =>
  Effect.gen(function* () {
    const tools = yield* Tool.Service
    const result = yield* run(tools, { title: "Revenue", description: "USD thousands", spec: JSON.stringify(revenue) })

    expect(result.status).toBe("completed")
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(revenue) }])
    expect(result.metadata).toMatchObject({ title: "Revenue", description: "USD thousands" })
  }),
)

vscode.effect("reports unparseable JSON without failing the call", () =>
  Effect.gen(function* () {
    const tools = yield* Tool.Service
    const result = yield* run(tools, { title: "Broken", spec: "{" })

    expect(result.status).toBe("completed")
    expect(result.metadata).toMatchObject({ title: "Broken", error: "invalid-json" })
    expect(result.content?.[0]).toMatchObject({ type: "text", text: expect.stringContaining("could not parse JSON") })
  }),
)

vscode.effect("reports a spec without type or data", () =>
  Effect.gen(function* () {
    const tools = yield* Tool.Service
    const result = yield* run(tools, { title: "Broken", spec: JSON.stringify({ type: "bar" }) })

    expect(result.status).toBe("completed")
    expect(result.metadata).toMatchObject({ title: "Broken", error: "invalid-spec" })
    expect(result.content?.[0]).toMatchObject({ type: "text", text: expect.stringContaining('"type" and "data"') })
  }),
)

test("normalizeChartSpec remaps area to a filled line chart", () => {
  const result = normalizeChartSpec(
    JSON.stringify({ type: "area", data: { labels: ["A", "B"], datasets: [{ data: [1, 2] }] } }),
  )

  expect("error" in result).toBe(false)
  if ("error" in result) return
  expect(result.spec.type).toBe("line")
  const datasets = (result.spec.data as { datasets: Array<Record<string, unknown>> }).datasets
  expect(datasets[0]).toMatchObject({ data: [1, 2], fill: true })
})

test("normalizeChartSpec keeps an explicit fill", () => {
  const result = normalizeChartSpec(
    JSON.stringify({ type: "area", data: { datasets: [{ data: [1], fill: false }] } }),
  )

  if ("error" in result) return
  const datasets = (result.spec.data as { datasets: Array<Record<string, unknown>> }).datasets
  expect(datasets[0]?.fill).toBe(false)
})