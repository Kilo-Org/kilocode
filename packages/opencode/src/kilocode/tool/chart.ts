// kilocode_change - new file
import { Effect, Schema } from "effect"
import * as Tool from "../../tool/tool"

const Parameters = Schema.Struct({
  title: Schema.String.annotate({
    description: "Short label for the chart shown in the tool header",
  }),
  description: Schema.optional(Schema.String).annotate({
    description: "Optional subtitle shown below the title",
  }),
  spec: Schema.String.annotate({
    description: "A Chart.js v4 configuration serialized as a JSON string. Pass the JSON object as a plain string value — do not nest objects, do not escape quotes manually. Example: '{\"type\":\"bar\",\"data\":{\"labels\":[\"A\",\"B\"],\"datasets\":[{\"data\":[1,2]}]}}'",
  }),
})

type Meta = {
  title: string
  description?: string
  error?: string
}

export const ChartTool = Tool.define(
  "chart",
  Effect.gen(function* () {
    return {
      description:
        "Render a data visualization chart using a Chart.js v4 config. Use this when the user explicitly asks for a chart, graph, or plot. Supported types: bar, bubble, pie, doughnut, line (use fill:true for area charts), mixed, polarArea, radar, scatter. Do NOT use this for diagrams, flowcharts, sequence diagrams, or any mermaid content — write those as mermaid fenced code blocks in your text response instead. After calling this tool, do NOT output the JSON spec or raw data in your text response — the chart is the response.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.metadata({
            title: params.title,
            metadata: { title: params.title, description: params.description } as Meta,
          })

          let spec: unknown
          try {
            spec = JSON.parse(params.spec)
          } catch {
            return {
              title: params.title,
              output: `Invalid chart spec: could not parse JSON. If you are trying to render a diagram or mermaid chart, do NOT use the chart tool — write a mermaid fenced code block in your text response instead.`,
              metadata: { title: params.title, description: params.description, error: "invalid-json" } as Meta,
            }
          }

          if (!spec || typeof spec !== "object" || !("type" in spec) || !("data" in spec)) {
            return {
              title: params.title,
              output: `Invalid chart spec: must be a Chart.js v4 config with "type" and "data" fields. If you are trying to render a mermaid diagram, do NOT use the chart tool — write a mermaid fenced code block in your text response instead.`,
              metadata: { title: params.title, description: params.description, error: "invalid-spec" } as Meta,
            }
          }

          // "area" is not a Chart.js type — remap to line with fill
          if ((spec as Record<string, unknown>).type === "area") {
            const s = spec as Record<string, unknown>
            s.type = "line"
            const data = s.data as Record<string, unknown> | undefined
            if (data && Array.isArray(data.datasets)) {
              data.datasets = (data.datasets as Record<string, unknown>[]).map((ds) => ({
                fill: true,
                ...ds,
              }))
            }
          }

          return {
            title: params.title,
            output: JSON.stringify(spec),
            metadata: { title: params.title, description: params.description } as Meta,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
