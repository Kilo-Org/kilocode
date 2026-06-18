import path from "path"
import { Filesystem } from "@/util/filesystem"

export namespace ConfigRules {
  const names = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"] as const

  type Ctx = {
    directory: string
    worktree?: string
  }

  function root(ctx: Ctx) {
    return ctx.worktree && ctx.worktree !== "/" ? ctx.worktree : ctx.directory
  }

  function target(ctx: Ctx) {
    return path.join(root(ctx), "AGENTS.md")
  }

  export async function read(ctx: Ctx) {
    const dir = root(ctx)
    const files = await Promise.all(
      names.map(async (name) => {
        const file = path.join(dir, name)
        const exists = await Bun.file(file).exists()
        return {
          name,
          path: file,
          exists,
          editable: name === "AGENTS.md",
          content: exists ? await Bun.file(file).text() : "",
        }
      }),
    )
    return {
      scope: "project" as const,
      target: target(ctx),
      files,
    }
  }

  export async function update(input: Ctx & { content: string }) {
    await Filesystem.write(target(input), input.content)
    return read(input)
  }
}
