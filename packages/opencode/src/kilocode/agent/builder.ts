import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util/filesystem"

export namespace AgentBuilder {
  export const Scope = z.enum(["global", "project"])
  export type Scope = z.infer<typeof Scope>

  export const Mode = z.enum(["primary", "subagent", "all"])

  export const ID = z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)

  export const Params = z.object({
    id: ID,
  })

  const Body = z.object({
    scope: Scope.default("project"),
    description: z.string().optional(),
    mode: Mode.default("primary"),
    model: z.string().optional(),
    color: z.string().optional(),
    steps: z.number().int().positive().optional(),
    tools: z.string().array().optional(),
    permission: z.record(z.string(), z.unknown()).optional(),
    prompt: z.string().regex(/\S/).trim(),
  })

  export const Input = Body.extend({
    id: ID,
  })
  export type Input = z.infer<typeof Input>

  export const SaveInput = Body.extend({
    id: ID.optional(),
  })
  export type SaveInput = z.infer<typeof SaveInput>

  export const Output = z.object({
    id: ID,
    scope: Scope,
    path: z.string(),
    markdown: z.string(),
  })
  export type Output = z.infer<typeof Output>

  export type Ctx = {
    directory: string
    worktree?: string
  }

  export async function preview(ctx: Ctx, input: Input): Promise<Output> {
    return {
      id: input.id,
      scope: input.scope,
      path: file(ctx, input.scope, input.id),
      markdown: markdown(input),
    }
  }

  export async function save(ctx: Ctx, input: Input): Promise<Output> {
    const output = await preview(ctx, input)
    await fs.mkdir(path.dirname(output.path), { recursive: true })
    await Filesystem.write(output.path, output.markdown)
    return output
  }

  function file(ctx: Ctx, scope: Scope, id: string) {
    const root =
      scope === "global" ? Global.Path.config : ctx.worktree && ctx.worktree !== "/" ? ctx.worktree : ctx.directory
    return path.join(root, scope === "global" ? "agent" : ".kilo/agent", `${id}.md`)
  }

  function markdown(input: Input) {
    const permission = input.tools?.length
      ? {
          ...Object.fromEntries(input.tools.map((tool) => [tool, "allow"])),
          ...input.permission,
        }
      : input.permission
    const data = clean({
      description: input.description,
      mode: input.mode,
      model: input.model,
      color: input.color,
      steps: input.steps,
      permission,
    })
    return `---\n${Object.entries(data)
      .map(([key, value]) => `${key}: ${format(value)}`)
      .join("\n")}\n---\n${input.prompt.trim()}\n`
  }

  function clean(input: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
  }

  function format(input: unknown): string {
    if (typeof input === "string") return JSON.stringify(input)
    if (typeof input === "number" || typeof input === "boolean") return String(input)
    return JSON.stringify(input)
  }
}
