import { describe, it, expect } from "bun:test"
import {
  fetchAndSendPendingPermissions,
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

function permissionClient(permsPerDir: Record<string, ReturnType<typeof pending>[]>, queries: string[]) {
  return {
    permission: {
      list: async (args?: { directory?: string }) => {
        const dir = args?.directory ?? ""
        queries.push(dir)
        return { data: permsPerDir[dir] ?? [] }
      },
      saveAlwaysRules: async () => ({ data: true }),
      reply: async () => ({ data: true }),
    },
  }
}

function client(
  permsPerDir: Record<string, ReturnType<typeof pending>[]>,
  queries: string[],
): PermissionContext["client"] {
  return permissionClient(permsPerDir, queries) as unknown as PermissionContext["client"]
}

function ctx(opts: {
  tracked: string[]
  dirs?: Map<string, string>
  permsPerDir?: Record<string, ReturnType<typeof pending>[]>
  workspace?: string
}) {
  const messages: unknown[] = []
  const queries: string[] = []
  const perms = opts.permsPerDir ?? {}
  const sdk = client(perms, queries)

  const permDirs = new Map<string, string>()
  const fake: PermissionContext = {
    client: sdk,
    currentSessionId: undefined,
    trackedSessionIds: new Set(opts.tracked),
    sessionDirectories: opts.dirs ?? new Map(),
    postMessage: (msg) => messages.push(msg),
    getWorkspaceDirectory: () => opts.workspace ?? "/workspace",
    recordPermissionDirectory: (id, dir) => permDirs.set(id, dir),
    getPermissionDirectory: (id) => permDirs.get(id),
    clearPermissionDirectory: (id) => {
      permDirs.delete(id)
    },
    prunePermissionDirectories: (active) => {
      for (const key of permDirs.keys()) {
        if (!active.has(key)) permDirs.delete(key)
      }
    },
  }

  return { fake, messages, queries, permDirs }
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
      postMessage: (msg) => messages.push(msg),
      getWorkspaceDirectory: () => "/workspace",
      recordPermissionDirectory: (id, dir) => permDirs.set(id, dir),
      getPermissionDirectory: (id) => permDirs.get(id),
      clearPermissionDirectory: (id) => {
        permDirs.delete(id)
      },
      prunePermissionDirectories: (active) => {
        for (const key of permDirs.keys()) {
          if (!active.has(key)) permDirs.delete(key)
        }
      },
    }
    await fetchAndSendPendingPermissions(fake)
    expect(messages).toHaveLength(0)
  })
})
