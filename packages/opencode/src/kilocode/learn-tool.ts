// kilocode_change - new file
import z from "zod"
import { Tool } from "../tool/tool"
import { LearnTracker } from "./learn-tracker"

export const LearnWriteTool = Tool.define("learnwrite", {
  description: [
    "Record a comprehension check result from a Learn mode session.",
    "Use this after the user answers (or skips) a comprehension question.",
    "This tracks what was understood, what was skipped, and where gaps exist.",
    "",
    "Parameters:",
    "- question: The question you asked",
    "- category: One of comprehension, reasoning, system, edge",
    "- quality: One of correct, partial, wrong, skipped",
    "- concepts: Array of identifiers/concepts the question covered",
  ].join("\n"),
  parameters: z.object({
    question: z.string().describe("The comprehension question that was asked"),
    category: LearnTracker.Category.describe("Question category"),
    quality: LearnTracker.Quality.describe("Quality of the user's answer"),
    concepts: z.array(z.string()).describe("Concepts or identifiers covered by this question"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "learnwrite",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const state = await LearnTracker.record({
      sessionID: ctx.sessionID,
      check: params,
    })
    const sum = LearnTracker.summary(state)
    return {
      title: `${state.checks.length} checks (level: ${state.level})`,
      output: JSON.stringify(sum, null, 2),
      metadata: { state },
    }
  },
})

export const LearnReadTool = Tool.define("learnread", {
  description: [
    "Read the current Learn mode tracking state for this session.",
    "Use this to check the user's current level, what they've understood, and where gaps exist.",
    "Use this before generating a Session Learning Log.",
  ].join("\n"),
  parameters: z.object({}),
  async execute(_params, ctx) {
    await ctx.ask({
      permission: "learnread",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const state = await LearnTracker.get(ctx.sessionID)
    const sum = LearnTracker.summary(state)
    return {
      title: `${state.checks.length} checks (level: ${state.level})`,
      output: JSON.stringify({ ...sum, checks: state.checks }, null, 2),
      metadata: { state },
    }
  },
})
