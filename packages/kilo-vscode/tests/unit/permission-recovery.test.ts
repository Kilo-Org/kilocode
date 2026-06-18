import { describe, it, expect, spyOn } from "bun:test"
import {
  fetchAndSendPendingPermissions,
  handlePermissionResponse,
  recoverablePermissions,
  recoveryDirs,
  type RecoverablePermission,
  type PermissionContext,
} from "../../src/kilo-provider/handlers/permission-handler"

/** Minimal permission shape returned by the SDK's permission.list(). */
function pending(id: string, sessionID: string, permission = "bash"): RecoverablePermission {
  return {
    id,
    sessionID,
    permission,
    patterns: ["*"],
    always: [] as string[],
    metadata: {},
    tool: undefined,
  }
}

function permissionClient(
  permsPerDir: Record<string, ReturnType<typeof pending>[]>,
  queries: string[],
  saves: unknown[] = [],
  replies: unknown[] = [],
  errors?: { list?: Record<string, unknown>; save?: unknown; reply?: unknown },
) {
  return {
    permission: {
      list: async (args?: { directory?: string }) => {
        const dir = args?.directory ?? ""
        queries.push(dir)
        const error = errors?.list?.[dir]
        if (error) return { data: undefined, error }
        return { data: permsPerDir[dir] ?? [] }
      },
      saveAlwaysRules: async (args: unknown) => {
        saves.push(args)
        if (errors?.save) throw errors.save
        return { data: true }
      },
      reply: async (args: unknown) => {
        replies.push(args)
        if (errors?.reply) throw errors.reply
        return { data: true }
      },
    },
  }
}

function client(
  permsPerDir: Record<string, ReturnType<typeof pending>[]>,
  queries: string[],
  saves: unknown[] = [],
  replies: unknown[] = [],
  errors?: { list?: Record<string, unknown>; save?: unknown; reply?: unknown },
): PermissionContext["client"] {
  return permissionClient(permsPerDir, queries, saves, replies, errors) as unknown as PermissionContext["client"]
}

function ctx(opts: {
  tracked: string[]
  dirs?: Map<string, string>
  permsPerDir?: Record<string, ReturnType<typeof pending>[]>
  workspace?: string
  errors?: { list?: Record<string, unknown>; save?: unknown; reply?: unknown }
  extra?: string[]
}) {
  const messages: unknown[] = []
  const queries: string[] = []
  const saves: unknown[] = []
  const replies: unknown[] = []
  const perms = opts.permsPerDir ?? {}
  const sdk = client(perms, queries, saves, replies, opts.errors)

  const permDirs = new Map<string, string>()
  const fake: PermissionContext = {
    client: sdk,
    currentSessionId: undefined,
    trackedSessionIds: new Set(opts.tracked),
    sessionDirectories: opts.dirs ?? new Map(),
    extraDirectories: () => opts.extra ?? [],
    postMessage: (msg) => messages.push(msg),
    getWorkspaceDirectory: () => opts.workspace ?? "/workspace",
    recordPermissionDirectory: (id, dir) => permDirs.set(id, dir),
    getPermissionDirectory: (id) => permDirs.get(id),
    clearPermissionDirectory: (id) => {
      permDirs.delete(id)
    },
    prunePermissionDirectories: (active, dirs) => {
      for (const [key, dir] of permDirs) {
        if (active.has(key)) {
          continue
        }
        if (dirs && !dirs.has(dir)) {
          continue
        }
        permDirs.delete(key)
      }
    },
  }

  return { fake, messages, queries, saves, replies, permDirs }
}

describe("recoveryDirs", () => {
  it("returns workspace root when sessionDirectories is empty", () => {
    expect(recoveryDirs("/workspace", new Map())).toEqual(["/workspace"])
  })

  it("returns workspace root plus each unique worktree directory", () => {
    const dirs = new Map([
      ["s1", "/workspace/.kilo/worktrees/alpha"],
      ["s2", "/workspace/.kilo/worktrees/beta"],
      ["s3", "/workspace/.kilo/worktrees/alpha"],
    ])
    expect(recoveryDirs("/workspace", dirs)).toEqual([
      "/workspace",
      "/workspace/.kilo/worktrees/alpha",
      "/workspace/.kilo/worktrees/beta",
    ])
  })

  it("includes extra worktree directories", () => {
    const dirs = new Map([["s1", "/workspace/.kilo/worktrees/alpha"]])
    expect(recoveryDirs("/workspace", dirs, ["/workspace/.kilo/worktrees/beta", "/workspace"])).toEqual([
      "/workspace",
      "/workspace/.kilo/worktrees/alpha",
      "/workspace/.kilo/worktrees/beta",
    ])
  })
})

describe("handlePermissionResponse", () => {
  it("uses the recorded SSE directory instead of a stale session fallback", async () => {
    const { fake, replies, permDirs } = ctx({ tracked: ["s1"] })
    permDirs.set("p1", "/workspace/.kilo/worktrees/feature")

    await handlePermissionResponse(fake, "p1", "s1", "once", [], [])

    expect(replies).toEqual([{ requestID: "p1", reply: "once", directory: "/workspace/.kilo/worktrees/feature" }])
  })

  it("saves selected rules and replies in the recorded SSE directory", async () => {
    const { fake, saves, replies, permDirs } = ctx({ tracked: ["s1"] })
    permDirs.set("p1", "/workspace/.kilo/worktrees/feature")

    await handlePermissionResponse(fake, "p1", "s1", "reject", ["bun *"], ["rm *"])

    expect(saves).toEqual([
      {
        requestID: "p1",
        directory: "/workspace/.kilo/worktrees/feature",
        approvedAlways: ["bun *"],
        deniedAlways: ["rm *"],
      },
    ])
    expect(replies).toEqual([{ requestID: "p1", reply: "reject", directory: "/workspace/.kilo/worktrees/feature" }])
  })

  it("treats an SDK-wrapped 404 while saving rules as stale", async () => {
    const error = new Error("Permission request not found: p1", {
      cause: { status: 404, body: { name: "NotFoundError" } },
    })
    const { fake, messages, saves, replies, permDirs } = ctx({ tracked: ["s1"], errors: { save: error } })
    permDirs.set("p1", "/workspace/.kilo/worktrees/feature")

    await handlePermissionResponse(fake, "p1", "s1", "once", ["bun *"], [])

    expect(saves).toEqual([
      {
        requestID: "p1",
        directory: "/workspace/.kilo/worktrees/feature",
        approvedAlways: ["bun *"],
        deniedAlways: [],
      },
    ])
    expect(replies).toEqual([])
    expect(permDirs.has("p1")).toBe(false)
    expect(messages).toEqual([{ type: "permissionError", permissionID: "p1", stale: true }])
  })

  it("treats an SDK-wrapped 404 while replying as stale", async () => {
    const error = new Error("Permission request not found: p1", {
      cause: { status: 404, body: { name: "NotFoundError" } },
    })
    const { fake, messages, replies, permDirs } = ctx({ tracked: ["s1"], errors: { reply: error } })
    permDirs.set("p1", "/workspace/.kilo/worktrees/feature")

    await handlePermissionResponse(fake, "p1", "s1", "once", [], [])

    expect(replies).toEqual([{ requestID: "p1", reply: "once", directory: "/workspace/.kilo/worktrees/feature" }])
    expect(permDirs.has("p1")).toBe(false)
    expect(messages).toEqual([{ type: "permissionError", permissionID: "p1", stale: true }])
  })

  it("does not treat other SDK-wrapped errors as stale", async () => {
    const error = new Error("Internal server error", {
      cause: { status: 500, body: { name: "InternalServerError" } },
    })
    const { fake, messages, permDirs } = ctx({ tracked: ["s1"], errors: { reply: error } })
    const spy = spyOn(console, "error").mockImplementation(() => {})
    permDirs.set("p1", "/workspace/.kilo/worktrees/feature")

    await handlePermissionResponse(fake, "p1", "s1", "once", [], [])
    spy.mockRestore()

    expect(permDirs.has("p1")).toBe(true)
    expect(messages).toEqual([{ type: "permissionError", permissionID: "p1" }])
  })
})

describe("recoverablePermissions", () => {
  it("filters out untracked permissions", () => {
    const seen = new Set<string>()
    expect(recoverablePermissions([pending("p1", "s1"), pending("p2", "s2")], new Set(["s1"]), seen)).toEqual([
      pending("p1", "s1"),
    ])
  })

  it("deduplicates permissions across queries", () => {
    const seen = new Set<string>()
    expect(recoverablePermissions([pending("p1", "s1"), pending("p1", "s1")], new Set(["s1"]), seen)).toHaveLength(1)
    expect(recoverablePermissions([pending("p1", "s1")], new Set(["s1"]), seen)).toHaveLength(0)
  })
})

describe("fetchAndSendPendingPermissions", () => {
  it("queries only workspace root when sessionDirectories is empty", async () => {
    const { fake, queries } = ctx({ tracked: ["s1"] })
    await fetchAndSendPendingPermissions(fake)
    expect(queries).toEqual(["/workspace"])
  })

  it("queries workspace root plus each unique worktree directory", async () => {
    const dirs = new Map([
      ["s1", "/workspace/.kilo/worktrees/alpha"],
      ["s2", "/workspace/.kilo/worktrees/beta"],
    ])
    const { fake, queries } = ctx({ tracked: ["s1", "s2"], dirs })
    await fetchAndSendPendingPermissions(fake)
    expect(queries).toContain("/workspace")
    expect(queries).toContain("/workspace/.kilo/worktrees/alpha")
    expect(queries).toContain("/workspace/.kilo/worktrees/beta")
    expect(queries).toHaveLength(3)
  })

  it("queries extra Agent Manager worktree directories", async () => {
    const { fake, queries, permDirs } = ctx({
      tracked: ["s1"],
      extra: ["/workspace/.kilo/worktrees/late"],
      permsPerDir: { "/workspace/.kilo/worktrees/late": [pending("p1", "s1")] },
    })
    await fetchAndSendPendingPermissions(fake)
    expect(queries).toEqual(["/workspace", "/workspace/.kilo/worktrees/late"])
    expect(permDirs.get("p1")).toBe("/workspace/.kilo/worktrees/late")
  })

  it("preserves cached routes for directories that fail to list", async () => {
    const dirs = new Map([["s1", "/workspace/.kilo/worktrees/failing"]])
    const error = new Error("temporary failure")
    const { fake, permDirs } = ctx({
      tracked: ["s1"],
      dirs,
      errors: { list: { "/workspace/.kilo/worktrees/failing": error } },
    })
    const spy = spyOn(console, "error").mockImplementation(() => {})
    permDirs.set("workspace-stale", "/workspace")
    permDirs.set("worktree-pending", "/workspace/.kilo/worktrees/failing")

    await fetchAndSendPendingPermissions(fake)
    spy.mockRestore()

    expect(permDirs.has("workspace-stale")).toBe(false)
    expect(permDirs.get("worktree-pending")).toBe("/workspace/.kilo/worktrees/failing")
  })

  it("deduplicates directories", async () => {
    const dirs = new Map([
      ["s1", "/workspace/.kilo/worktrees/alpha"],
      ["s2", "/workspace/.kilo/worktrees/alpha"],
    ])
    const { fake, queries } = ctx({ tracked: ["s1", "s2"], dirs })
    await fetchAndSendPendingPermissions(fake)
    expect(queries.filter((d) => d === "/workspace/.kilo/worktrees/alpha")).toHaveLength(1)
  })

  it("forwards permissions from worktree directories", async () => {
    const dirs = new Map([["s1", "/wt"]])
    const { fake, messages } = ctx({
      tracked: ["s1"],
      dirs,
      permsPerDir: { "/wt": [pending("p1", "s1")] },
    })
    await fetchAndSendPendingPermissions(fake)
    expect(messages).toHaveLength(1)
    const msg = messages[0] as { type: string; permission: { id: string } }
    expect(msg.type).toBe("permissionRequest")
    expect(msg.permission.id).toBe("p1")
  })

  it("does not forward permissions from untracked sessions", async () => {
    const { fake, messages } = ctx({
      tracked: ["s1"],
      permsPerDir: { "/workspace": [pending("p1", "s-other")] },
    })
    await fetchAndSendPendingPermissions(fake)
    expect(messages).toHaveLength(0)
  })

  it("deduplicates permissions across directories", async () => {
    const dirs = new Map([["s1", "/wt"]])
    const p = pending("p1", "s1")
    const { fake, messages } = ctx({
      tracked: ["s1"],
      dirs,
      permsPerDir: { "/workspace": [p], "/wt": [p] },
    })
    await fetchAndSendPendingPermissions(fake)
    expect(messages).toHaveLength(1)
  })

  it("does nothing when client is null", async () => {
    const messages: unknown[] = []
    const permDirs = new Map<string, string>()
    const fake: PermissionContext = {
      client: null,
      currentSessionId: undefined,
      trackedSessionIds: new Set(["s1"]),
      sessionDirectories: new Map(),
      extraDirectories: () => [],
      postMessage: (msg) => messages.push(msg),
      getWorkspaceDirectory: () => "/workspace",
      recordPermissionDirectory: (id, dir) => permDirs.set(id, dir),
      getPermissionDirectory: (id) => permDirs.get(id),
      clearPermissionDirectory: (id) => {
        permDirs.delete(id)
      },
      prunePermissionDirectories: (active, dirs) => {
        for (const [key, dir] of permDirs) {
          if (active.has(key)) {
            continue
          }
          if (dirs && !dirs.has(dir)) {
            continue
          }
          permDirs.delete(key)
        }
      },
    }
    await fetchAndSendPendingPermissions(fake)
    expect(messages).toHaveLength(0)
  })
})
