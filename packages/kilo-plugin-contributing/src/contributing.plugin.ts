import type { Plugin } from "@opencode-ai/plugin"
import { join } from "node:path"

const CONTRIBUTING_FILE = process.env.KILOCODE_CONTRIBUTING_FILE ?? ".kilocode/CONTRIBUTING.md"
const service = "kilo-plugin-contributing"

export const ContributingPlugin: Plugin = async (ctx) => {
  const path = join(ctx.directory, CONTRIBUTING_FILE)
  const file = Bun.file(path)

  void ctx.client.app.log({
    body: {
      level: "debug",
      service,
      message: `Plugin initalized with path ${path}`,
    },
  })

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      if (!(await file.exists())) {
        await ctx.client.app.log({
          body: {
            level: "debug",
            service,
            message: `No contributing guide found at ${path}`,
          },
        })
        return
      }

      const content = await file.text()

      output.system.push(getPrompt(path, content))
    },
  }
}
function getPrompt(contributingPath: string, content: string) {
  return `
You have access to this project's contributing guide below. As you work on this project:
- Reference the contributing guide for context on architecture, conventions, and decisions
- If you discover new patterns, make architectural decisions, or learn important project details, update the contributing guide to reflect this knowledge
- Keep the contributing guide accurate, concise, and comprehensive
- Update the contributing guide with the write tool at file path: ${contributingPath}

# Contributing Guide

${content}`
}
