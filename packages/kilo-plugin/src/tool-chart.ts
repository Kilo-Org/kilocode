import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"

/** The tool id the Kilo host registers on the server and the renderer registers in the client. */
export const ChartToolName = "chart"

const Parameters = Schema.Struct({
  title: Schema.String.annotate({
    description: "Short label for the chart shown in the tool header",
  }),
  description: Schema.optional(Schema.String).annotate({
    description: "Optional subtitle shown below the title",
  }),
  spec: Schema.String.annotate({
    description:
      "A Chart.js v4 configuration serialized as a JSON string. Pass the JSON object as a plain string value, do not nest objects, do not escape quotes manually. Example: '{\"type\":\"bar\",\"data\":{\"labels\":[\"A\",\"B\"],\"datasets\":[{\"data\":[1,2]}]}}'",
  }),
})

type Parameters = typeof Parameters.Type

type ChartMeta = {
  title: string
  description?: string
  error?: "invalid-json" | "invalid-spec"
}

const DESCRIPTION = `Render a data visualization chart using a Chart.js v4 config. Use this when the user explicitly asks for a chart, graph, or plot. Supported types: bar, bubble, pie, doughnut, line (use fill:true for area charts), mixed, polarArea, radar, scatter. Do NOT use this for diagrams, flowcharts, sequence diagrams, or any mermaid content. Write those as mermaid fenced code blocks in your text response instead. After calling this tool, do NOT output the JSON spec or raw data in your text response. The chart is the response.`

const INVALID_JSON = `Invalid chart spec: could not parse JSON. If you are trying to render a diagram or mermaid chart, do NOT use the chart tool. Write a mermaid fenced code block in your text response instead.`

const INVALID_SPEC = `Invalid chart spec: must be a Chart.js v4 config with "type" and "data" fields. If you are trying to render a mermaid diagram, do NOT use the chart tool. Write a mermaid fenced code block in your text response instead.`

export type ChartSpec = Record<string, unknown> & { type: unknown; data: unknown }

/**
 * Validate the model-supplied spec and remap `area`, which is not a Chart.js type, to a filled line chart.
 */
export function normalizeChartSpec(raw: string): { spec: ChartSpec } | { error: "invalid-json" | "invalid-spec" } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: "invalid-json" }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: "invalid-spec" }
  const spec = parsed as Record<string, unknown>
  if (!spec.type || !spec.data) return { error: "invalid-spec" }
  if (spec.type === "area") {
    spec.type = "line"
    const data = spec.data as Record<string, unknown>
    if (Array.isArray(data.datasets))
      data.datasets = data.datasets.map((dataset) => (dataset && typeof dataset === "object" ? { fill: true, ...dataset } : dataset))
  }
  return { spec: spec as ChartSpec }
}

/**
 * The chart tool renders a Chart.js configuration in a client. It is registered only for the VS Code
 * client, which owns the chart renderer; other clients get no chart tool.
 */
export const KiloChartToolPlugin = define({
  id: "kilocode.tool-chart",
  effect: Effect.fn("KiloChartTool.Plugin")(function* (ctx) {
    if (ctx.app.name !== "vscode") return
    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: ChartToolName,
        options: { codemode: false },
        description: DESCRIPTION,
        input: Parameters,
        execute: (input: Parameters, context) =>
          Effect.gen(function* () {
            yield* context.progress({ title: input.title, description: input.description })

            const result = normalizeChartSpec(input.spec)
            if ("error" in result) {
              const metadata: ChartMeta = {
                title: input.title,
                description: input.description,
                error: result.error,
              }
              return {
                content: result.error === "invalid-json" ? INVALID_JSON : INVALID_SPEC,
                metadata,
              }
            }

            return {
              content: JSON.stringify(result.spec),
              metadata: { title: input.title, description: input.description } satisfies ChartMeta,
            }
          }),
      }),
    )
  }),
})