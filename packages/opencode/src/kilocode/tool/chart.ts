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
    description: "A valid Chart.js v4 JSON configuration string describing the chart to render",
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
        "Render a data visualization chart using a Chart.js v4 config. Use this when the user asks to visualize data as a chart, graph, or plot. The config is rendered inline in the session.",
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
              output: `Invalid chart spec: could not parse JSON. Please provide a valid Chart.js v4 JSON string.`,
              metadata: { title: params.title, description: params.description, error: "invalid-json" } as Meta,
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
