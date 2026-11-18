import type { Tool } from "@opencode/schema/tool"
import { Effect, Option, Schema } from "effect"
import DESCRIPTION from "./chart.txt"

const Parameters = Schema.Struct({
  title: Schema.String.annotate({
    description: "Short label for the chart shown in the tool header",
  }),
  description: Schema.optional(Schema.String).annotate({
    description: "Optional subtitle shown below the title",
  }),
  spec: Schema.String.annotate({
    description:
      "A Chart.js v4 configuration serialized as a JSON string. Pass the JSON object as a plain string value — do not nest objects, do not escape quotes manually. Example: '{\"type\":\"bar\",\"data\":{\"labels\":[\"A\",\"B\"],\"datasets\":[{\"data\":[1,2]}]}}'",
  }),
})

const Output = Schema.String

type Meta = {
  title: string
  description?: string
  error?: string
}

// The Kilo chat parses this output as a Chart.js config and draws it on a canvas. The tool returns that config as
// JSON; the messages for an unusable spec are plain text the chat cannot draw.
export function makeTool(): Tool.Info<typeof Parameters, typeof Output> {
  return {
    name: "chart",
    // The chat draws this tool's own card, so it stays a direct tool instead of a Code Mode call.
    options: { codemode: false },
    description: DESCRIPTION,
    input: Parameters,
    output: Output,
    execute: (params, context) =>
      Effect.gen(function* () {
        yield* context.progress({ title: params.title, description: params.description } satisfies Meta)

        const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(params.spec)
        if (Option.isNone(decoded)) {
          return {
            output: `Invalid chart spec: could not parse JSON. If you are trying to render a diagram or mermaid chart, do NOT use the chart tool — write a mermaid fenced code block in your text response instead.`,
            metadata: { title: params.title, description: params.description, error: "invalid-json" } satisfies Meta,
          }
        }

        const spec = decoded.value
        if (!spec || typeof spec !== "object" || !("type" in spec) || !("data" in spec)) {
          return {
            output: `Invalid chart spec: must be a Chart.js v4 config with "type" and "data" fields. If you are trying to render a mermaid diagram, do NOT use the chart tool — write a mermaid fenced code block in your text response instead.`,
            metadata: { title: params.title, description: params.description, error: "invalid-spec" } satisfies Meta,
          }
        }

        // "area" is not a Chart.js type — remap to line with fill
        if (spec.type === "area") {
          spec.type = "line"
          const data = spec.data as Record<string, unknown> | undefined
          if (data && Array.isArray(data.datasets)) {
            data.datasets = (data.datasets as Record<string, unknown>[]).map((dataset) => ({
              fill: true,
              ...dataset,
            }))
          }
        }

        return {
          output: JSON.stringify(spec),
          metadata: { title: params.title, description: params.description } satisfies Meta,
        }
      }),
  }
}
