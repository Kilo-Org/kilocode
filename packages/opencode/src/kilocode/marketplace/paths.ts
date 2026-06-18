import { Global } from "@opencode-ai/core/global"
import os from "os"
import path from "path"

export type Ctx = {
  directory: string
  worktree: string
}

export function root(ctx: Ctx) {
  return ctx.worktree && ctx.worktree !== "/" ? ctx.worktree : ctx.directory
}

export function config(scope: "project" | "global", ctx: Ctx) {
  if (scope === "project") return path.join(root(ctx), ".kilo", "kilo.json")
  return path.join(Global.Path.config, "kilo.json")
}

export function agents(scope: "project" | "global", ctx: Ctx) {
  if (scope === "project") return [path.join(root(ctx), ".kilo", "agent"), path.join(root(ctx), ".kilo", "agents")]
  return [path.join(Global.Path.config, "agent"), path.join(Global.Path.config, "agents")]
}

export function agent(scope: "project" | "global", ctx: Ctx) {
  return agents(scope, ctx)[0]
}

export function skills(scope: "project" | "global", ctx: Ctx) {
  if (scope === "project") return path.join(root(ctx), ".kilo", "skills")
  return path.join(Global.Path.config, "skills")
}

export function skillRoots(scope: "project" | "global", ctx: Ctx) {
  if (scope === "project") return [path.join(root(ctx), ".kilo", "skills"), path.join(root(ctx), ".kilocode", "skills")]
  return [
    path.join(Global.Path.config, "skills"),
    path.join(os.homedir(), ".kilo", "skills"),
    path.join(os.homedir(), ".kilocode", "skills"),
  ]
}
