// kilocode_change - new file
import z from "zod"
import { Memory } from "../kilocode/memory"
import { Tool } from "./tool"

const DESCRIPTION = [
  "Store, list, and forget small pieces of durable project memory.",
  "Use this to persist user-approved facts that should survive restarts.",
].join(" ")

export const RememberTool = Tool.define("kilo_local_remember", {
  description: DESCRIPTION,
  parameters: z.object({
    mode: z.enum(["add", "list", "forget"]).describe("'add' stores memory, 'list' shows memory, 'forget' removes memory"),
    key: z.string().optional().describe("Short memory key, required for add and forget"),
    content: z.string().optional().describe("Memory content, required for add"),
    limit: z.number().optional().describe("Maximum number of memories to list (default: 20, max: 50)"),
  }),
  async execute(params, ctx) {
    if (params.mode === "list") {
      return list(params)
    }
    if (params.mode === "forget") {
      return forget(params, ctx)
    }
    return add(params, ctx)
  },
})

async function add(params: { key?: string; content?: string }, ctx: Tool.Context) {
  if (!params.key?.trim()) {
    throw new Error("The 'key' parameter is required when mode is 'add'")
  }
  if (!params.content?.trim()) {
    throw new Error("The 'content' parameter is required when mode is 'add'")
  }

  await ctx.ask({
    permission: "remember",
    patterns: [params.key],
    always: [params.key],
    metadata: {
      mode: "add",
      key: params.key,
    },
  })

  await Memory.set({ key: params.key, content: params.content })
  return {
    title: `Remembered: ${params.key}`,
    output: params.content,
    metadata: {},
  }
}

async function list(params: { limit?: number }) {
  const items = await Memory.list({ limit: Math.min(params.limit ?? 20, 50) })
  if (!items.length) {
    return {
      title: "Persistent memory (empty)",
      output: "No persistent project memory stored.",
      metadata: {},
    }
  }

  return {
    title: `Persistent memory (${items.length} items)`,
    output: items.map((item) => `- ${item.key}: ${item.content}`).join("\n"),
    metadata: {},
  }
}

async function forget(params: { key?: string }, ctx: Tool.Context) {
  if (!params.key?.trim()) {
    throw new Error("The 'key' parameter is required when mode is 'forget'")
  }

  await ctx.ask({
    permission: "remember",
    patterns: [params.key],
    always: [params.key],
    metadata: {
      mode: "forget",
      key: params.key,
    },
  })

  await Memory.remove({ key: params.key })
  return {
    title: `Forgot: ${params.key}`,
    output: `Removed persistent memory for \"${params.key}\".`,
    metadata: {},
  }
}
