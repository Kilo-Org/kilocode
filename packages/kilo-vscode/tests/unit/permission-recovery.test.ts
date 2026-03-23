import { describe, it, expect } from "bun:test"
import {
  fetchAndSendPendingPermissions,
  type PermissionContext,
} from "../../src/kilo-provider/handlers/permission-handler"

/** Minimal permission shape returned by the SDK's permission.list(). */
function pending(id: string, sessionID: string, permission = "bash") {
  return {
    id,
    sessionID,
    permission,
    patterns: ["*"],
    always: [] as string[],
    metadata: {},
    tool: {},
  }
}

/**
 * Build a fake PermissionContext for testing fetchAndSendPendingPermissions.
 * `permsPerDir` maps directory → array of pending permissions the fake backend returns.
 */
function ctx(opts: {
  tracked: string[]
  dirs?: Map<string, string>
  permsPerDir?: Record<string, ReturnType<typeof pending>[]>
  workspace?: string
}) {
  const messages: unknown[] = []
  const queries: string[] = []
  const perms = opts.permsPerDir ?? {}

  const fake: PermissionContext = {
    client: {
      permission: {
        list: async (args: { directory: string }) => {
          queries.push(args.directory)
          return { data: perms[args.directory] ?? [] }
        },
      },
    } as any,
    currentSessionId: undefined,
    trackedSessionIds: new Set(opts.tracked),
    sessionDirectories: opts.dirs ?? new Map(),
    postMessage: (msg) => messages.push(msg),
    getWorkspaceDirectory: () => opts.workspace ?? "/workspace",
  }

  return { fake, messages, queries }
}

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
    const msg = messages[0] as any
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
    const fake: PermissionContext = {
      client: null,
      currentSessionId: undefined,
      trackedSessionIds: new Set(["s1"]),
      sessionDirectories: new Map(),
      postMessage: (msg) => messages.push(msg),
      getWorkspaceDirectory: () => "/workspace",
    }
    await fetchAndSendPendingPermissions(fake)
    expect(messages).toHaveLength(0)
  })
})
