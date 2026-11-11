import { define } from "@opencode/plugin/effect/plugin"
import { AbsolutePath } from "@opencode/schema/schema"
import { Skill } from "@opencode/schema/skill"
import { Effect } from "effect"
import SKILL from "./chart-skill.txt"
import { makeTool } from "./tool"

const DESCRIPTION =
  "Use when the user asks to visualize data with charts, graphs, or plots using the `chart` tool (bar, line, scatter, pie, time series, etc.)."

// The chart tool exists only for the VS Code client, which draws the tool output as a Chart.js canvas in the chat.
// Another client would receive a tool whose result renders as raw JSON, so neither the tool nor its skill is
// registered there. The same client check gates the plan document tool.
export const KiloChartPlugin = define({
  id: "kilocode.chart",
  effect: Effect.fn("KiloChartPlugin")(function* (ctx) {
    if (process.env.OPENCODE_CLIENT !== "vscode") return

    yield* ctx.tool.transform((editor) => editor.add(makeTool()))
    // The skill tells the model that the tool exists, so it is only registered where the tool is.
    yield* ctx.skill.transform((editor) =>
      editor.add(
        Skill.Info.make({
          id: Skill.ID.make("chart"),
          name: Skill.Name.make("chart"),
          description: DESCRIPTION,
          path: AbsolutePath.make("/builtin/chart.md"),
          content: SKILL,
        }),
      ),
    )
  }),
})
