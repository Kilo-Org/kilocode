import { describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { profile } from "@/kilocode/sandbox/policy"
import type { InstanceContext } from "@/project/instance-context"
import { ProjectID } from "@/project/schema"

const ctx: InstanceContext = {
  directory: "/workspace/project",
  worktree: "/workspace",
  project: {
    id: ProjectID.make("sandbox-policy-test"),
    worktree: "/workspace",
    time: { created: 0, updated: 0 },
    sandboxes: ["/workspace/sandbox"],
  },
}

function paths() {
  return profile(ctx).filesystem.allowWrite.map((rule) => rule.path)
}

describe("sandbox policy", () => {
  test("allows project and Kilo state roots", () => {
    const result = paths()
    expect(result).toContain(ctx.worktree)
    expect(result).toContain(ctx.directory)
    expect(result).toContain(ctx.project.sandboxes?.[0])
    expect(result).toContain(Global.Path.data)
    expect(result).toContain(Global.Path.state)
    expect(result).toContain(Global.Path.tmp)
  })

  test("does not derive writable roots from tool permissions", () => {
    expect(new Set(paths())).toEqual(
      new Set([
        ctx.worktree,
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
      ]),
    )
    expect(profile(ctx).filesystem.denyNames).toContain(".git")
  })
})
