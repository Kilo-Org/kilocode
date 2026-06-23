import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { run as runSandbox, type Profile } from "@kilocode/sandbox"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import type { InstanceContext } from "@/project/instance-context"

function root(path: string) {
  return { path, kind: "subtree" as const }
}

export function profile(ctx: InstanceContext): Profile {
  const writable = [
    ...(ctx.worktree === "/" ? [] : [ctx.worktree]),
    ctx.directory,
    ...(ctx.project.sandboxes ?? []),
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
      mode: "allow",
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
    return yield* runSandbox(profile(yield* InstanceState.context), effect)
  })
}
