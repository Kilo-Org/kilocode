import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util/filesystem"

export namespace ClaudeContext {
  type Ctx = {
    directory: string
    worktree?: string
  }

  async function present(file: string) {
    return Bun.file(file).exists()
  }

  function root(ctx: Ctx) {
    return ctx.worktree && ctx.worktree !== "/" ? ctx.worktree : ctx.directory
  }

  async function hasProjectFile(ctx: Ctx, name: string) {
    return present(path.join(root(ctx), name))
  }

  async function hasGlobalFile(name: string) {
    return present(path.join(Global.Path.home, ".claude", name))
  }

  export async function read(ctx: Ctx) {
    const dir = root(ctx)
    const [projectPrompt, globalPrompt, projectSkills, globalSkills, projectCommands, globalCommands] = await Promise.all([
      hasProjectFile(ctx, "CLAUDE.md"),
      hasGlobalFile("CLAUDE.md"),
      Filesystem.isDir(path.join(dir, ".claude", "skills")),
      Filesystem.isDir(path.join(Global.Path.home, ".claude", "skills")),
      Filesystem.isDir(path.join(dir, ".claude", "commands")),
      Filesystem.isDir(path.join(Global.Path.home, ".claude", "commands")),
    ])

    return {
      instructions: { present: projectPrompt || globalPrompt },
      skills: { present: projectSkills || globalSkills },
      commands: { present: projectCommands || globalCommands },
    }
  }
}
