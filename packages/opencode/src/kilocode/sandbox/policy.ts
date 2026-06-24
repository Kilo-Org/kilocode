import { readFileSync, statSync } from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { run as runSandbox, type Profile } from "@kilocode/sandbox"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import type { InstanceContext } from "@/project/instance-context"
import * as Network from "./network"

function root(path: string) {
  return { path, kind: "subtree" as const }
}

function marker(dir: string) {
  try {
    const file = path.join(dir, ".git")
    const entry = statSync(file, { throwIfNoEntry: false })
    if (!entry?.isFile()) return false
    const match = readFileSync(file, "utf8")
      .trim()
      .match(/^gitdir:\s*(.+)$/i)
    if (!match) return true
    const git = path.resolve(dir, match[1])
    if (!statSync(git, { throwIfNoEntry: false })?.isDirectory()) return true
    return statSync(path.join(git, "commondir"), { throwIfNoEntry: false })?.isFile() ?? false
  } catch {
    return true
  }
}

function linked(dir: string, stop: string): boolean {
  if (marker(dir)) return true
  if (dir === stop) return false
  const parent = path.dirname(dir)
  if (parent === dir) return false
  return linked(parent, stop)
}

function isolated(ctx: InstanceContext) {
  if (ctx.worktree === "/") return true
  return linked(path.resolve(ctx.directory), path.resolve(ctx.worktree))
}

export function profile(ctx: InstanceContext, mode: Profile["network"]["mode"] = "deny"): Profile {
  const project = isolated(ctx)
    ? [ctx.directory]
    : ctx.directory === ctx.worktree
      ? [ctx.directory]
      : [ctx.worktree, ctx.directory]
  const writable = [
    ...project,
    Global.Path.data,
    Global.Path.cache,
    Global.Path.config,
    Global.Path.state,
    Global.Path.tmp,
    Global.Path.bin,
    Global.Path.log,
    Global.Path.repos,
  ].map(root)
  return {
    filesystem: {
      allowWrite: writable,
      denyWrite: [],
      denyNames: [".git"],
      temporaryDirectory: Global.Path.tmp,
    },
    network: {
      mode,
      allowedHosts: [],
    },
    environment: {
      deny: [],
      set: {
        TMPDIR: Global.Path.tmp,
        TMP: Global.Path.tmp,
        TEMP: Global.Path.tmp,
      },
    },
  }
}

export function execute<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const config = yield* Config.Service
    const cfg = yield* config.get()
    if (!cfg.experimental?.sandbox) return yield* effect
    const mode = cfg.experimental.sandbox_restrict_network === false ? "allow" : "deny"
    return yield* runSandbox(profile(yield* InstanceState.context, mode), effect)
  })
}

export function executeTool<A, E, R>(tool: { id: string }, effect: Effect.Effect<A, E, R>) {
  return execute(Network.tool(tool, effect))
}

export function executeMcp<A, E, R>(tool: object, effect: Effect.Effect<A, E, R>) {
  return execute(Network.mcp(tool, effect))
}
