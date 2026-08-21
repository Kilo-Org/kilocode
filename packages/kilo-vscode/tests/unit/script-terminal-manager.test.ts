import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { ScriptTerminalManager, type ScriptTerminalView } from "../../src/agent-manager/ScriptTerminalManager"
import { buildScriptTerminalWsUrl } from "../../src/agent-manager/script-terminal-url"
import { RunScriptManager, type RunStatus } from "../../src/agent-manager/run/manager"

interface PtyInput {
  location?: { directory?: string }
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  title?: string
}

interface PtyUpdate {
  ptyID: string
  location?: { directory?: string }
  size?: { cols: number; rows: number }
}

interface PtyInfo {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: "running" | "exited"
  pid: number
  exitCode?: number
}

interface PtyResponse {
  data?: { location: { directory: string }; data: PtyInfo }
  error?: unknown
}

function wait(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function info(status: PtyInfo["status"] = "running", exitCode?: number): PtyInfo {
  return {
    id: "pty-1",
    title: "Run",
    command: "bun",
    args: ["run", "check"],
    cwd: "/repo/worktree",
    status,
    pid: 42,
    ...(exitCode === undefined ? {} : { exitCode }),
  }
}

function harness(opts?: {
  create?: (input: PtyInput) => Promise<PtyResponse>
  get?: () => Promise<PtyResponse>
  remove?: () => Promise<{ data?: unknown; error?: unknown }>
}) {
  const calls: { create: PtyInput[]; get: unknown[]; update: PtyUpdate[]; remove: unknown[] } = {
    create: [],
    get: [],
    update: [],
    remove: [],
  }
  const snapshots: ScriptTerminalView[][] = []
  const closed: string[] = []
  const logs: string[] = []
  const client = {
    v2: {
      pty: {
        create: async (input: PtyInput) => {
          calls.create.push(input)
          return opts?.create ? opts.create(input) : { data: { location: { directory: config.cwd }, data: info() } }
        },
        get: async (input: unknown) => {
          calls.get.push(input)
          return opts?.get ? opts.get() : { data: { location: { directory: config.cwd }, data: info() } }
        },
        update: async (input: PtyUpdate) => {
          calls.update.push(input)
          return { data: info() }
        },
        remove: async (input: unknown) => {
          calls.remove.push(input)
          return opts?.remove ? opts.remove() : { data: undefined }
        },
      },
    },
  } as unknown as KiloClient
  const manager = new ScriptTerminalManager({
    getClient: () => client,
    getClientAsync: async () => client,
    buildWsUrl: (ptyID, cwd) => `ws://127.0.0.1:4096/api/pty/${ptyID}/connect?location=${cwd}`,
    getTerminalFont: () => ({ fontFamily: "Menlo", fontSize: 12 }),
    emit: (terminals) => snapshots.push(terminals),
    closed: (terminalId) => closed.push(terminalId),
    log: (msg) => logs.push(msg),
  })
  return { manager, calls, snapshots, closed, logs }
}

const config = {
  worktreeId: "wt-1",
  command: "bun",
  args: ["run", "check"],
  cwd: "/repo/worktree",
  env: { PATH: "/bin", WORKTREE_PATH: "/repo/worktree" },
}

describe("ScriptTerminalManager", () => {
  it("blocks a script PTY create while its worktree is being removed", async () => {
    const gate = deferred<PtyResponse>()
    const ctx = harness({ create: async () => gate.promise })
    const started = ctx.manager.start("setup", config, () => undefined)
    await wait()

    const blocked = ctx.manager.blockDirectory(config.cwd)
    await expect(ctx.manager.start("run", config, () => undefined)).rejects.toThrow("directory is being removed")
    gate.resolve({ data: { location: { directory: config.cwd }, data: info() } })
    await started
    const release = await blocked
    await ctx.manager.closeDirectory(config.cwd)
    release()

    expect(ctx.calls.remove).toHaveLength(1)
  })

  it("creates a Run PTY with explicit command settings and a safe snapshot", async () => {
    const ctx = harness()
    const done: unknown[] = []

    await ctx.manager.start("run", config, (exit) => done.push(exit))

    expect(ctx.calls.create).toEqual([
      {
        location: { directory: "/repo/worktree" },
        command: "bun",
        args: ["run", "check"],
        cwd: "/repo/worktree",
        env: { PATH: "/bin", WORKTREE_PATH: "/repo/worktree" },
        title: "Run",
      },
    ])
    expect(ctx.calls.get).toEqual([{ ptyID: "pty-1", location: { directory: "/repo/worktree" } }])
    expect(ctx.snapshots.at(-1)).toEqual([
      expect.objectContaining({
        worktreeId: "wt-1",
        kind: "run",
        title: "Run",
        state: "running",
        font: { fontFamily: "Menlo", fontSize: 12 },
      }),
    ])
    expect(JSON.stringify(ctx.snapshots.at(-1))).not.toContain('"command"')
    expect(JSON.stringify(ctx.snapshots.at(-1))).not.toContain('"env"')
    expect(done).toEqual([])
  })

  it("normalizes the internal local Run key to a null external worktree id", async () => {
    const ctx = harness()

    await ctx.manager.start("run", { ...config, worktreeId: "local", cwd: "/repo" }, () => undefined)

    expect(ctx.snapshots.at(-1)?.[0]?.worktreeId).toBeNull()
  })

  it("keeps identical worktree script terminals independent across projects", async () => {
    let id = 0
    const ctx = harness({
      create: async () => ({
        data: { location: { directory: config.cwd }, data: { ...info(), id: `pty-${++id}` } },
      }),
      get: async () => ({
        data: { location: { directory: config.cwd }, data: { ...info(), id: `pty-${id}` } },
      }),
    })

    await ctx.manager.start("setup", { ...config, projectId: "prj-a" }, () => undefined)
    await ctx.manager.start("setup", { ...config, projectId: "prj-b" }, () => undefined)

    expect(ctx.snapshots.at(-1)).toEqual([
      expect.objectContaining({ projectId: "prj-a", worktreeId: "wt-1", kind: "setup" }),
      expect.objectContaining({ projectId: "prj-b", worktreeId: "wt-1", kind: "setup" }),
    ])
    expect(ctx.manager.active("setup", "wt-1", "prj-a")).toBe(true)
    expect(ctx.manager.active("setup", "wt-1", "prj-b")).toBe(true)

    await ctx.manager.clear("setup", "wt-1", "prj-a")
    expect(ctx.manager.active("setup", "wt-1", "prj-a")).toBe(false)
    expect(ctx.manager.active("setup", "wt-1", "prj-b")).toBe(true)
  })

  it("builds canonical authenticated replay URLs", () => {
    const value = buildScriptTerminalWsUrl(
      { baseUrl: "http://127.0.0.1:4096", password: "secret" },
      "pty / 1",
      "/repo/worktree",
    )
    const url = new URL(value)

    expect(url.protocol).toBe("ws:")
    expect(url.pathname).toBe("/api/pty/pty%20%2F%201/connect")
    expect(url.searchParams.get("location[directory]")).toBe("/repo/worktree")
    expect(url.searchParams.get("cursor")).toBe("0")
    expect(url.searchParams.get("replayExited")).toBe("1")
    expect(url.searchParams.get("auth_token")).toBe(Buffer.from("kilo:secret").toString("base64"))
  })

  it("finishes once on a natural exit and retains the replayable terminal", async () => {
    const ctx = harness()
    const done: unknown[] = []

    await ctx.manager.start("run", config, (exit) => done.push(exit))
    const terminalId = ctx.snapshots.at(-1)?.[0]?.terminalId
    if (!terminalId) throw new Error("missing Run terminal")
    ctx.manager.exited("pty-1", 17)
    ctx.manager.exited("pty-1", 17)

    expect(done).toEqual([{ exitCode: 17 }])
    expect(ctx.calls.remove).toEqual([])
    expect(ctx.snapshots.at(-1)).toEqual([expect.objectContaining({ terminalId, state: "exited", exitCode: 17 })])

    expect(ctx.manager.intercept({ type: "agentManager.terminal.close", terminalId })).toBe(true)
    await wait()
    expect(ctx.calls.remove).toEqual([{ ptyID: "pty-1", location: { directory: "/repo/worktree" } }])
    expect(ctx.closed).toEqual([terminalId])
    expect(ctx.snapshots.at(-1)).toEqual([])
  })

  it("reconciles a PTY that exited before registration", async () => {
    const ctx = harness({
      get: async () => ({ data: { location: { directory: config.cwd }, data: info("exited", 7) } }),
    })
    const done: unknown[] = []

    await ctx.manager.start("run", config, (exit) => done.push(exit))

    expect(done).toEqual([{ exitCode: 7 }])
    expect(ctx.snapshots.at(-1)).toEqual([expect.objectContaining({ state: "exited", exitCode: 7 })])
  })

  it("reconciles an exit event that arrives before create registration", async () => {
    const gate = deferred<PtyResponse>()
    let state = info()
    const ctx = harness({
      create: async () => gate.promise,
      get: async () => ({ data: { location: { directory: config.cwd }, data: state } }),
    })
    const done: unknown[] = []
    const started = ctx.manager.start("run", config, (exit) => done.push(exit))

    await wait()
    state = info("exited", 9)
    ctx.manager.exited("pty-1", 9)
    gate.resolve({ data: { location: { directory: config.cwd }, data: info() } })
    await started

    expect(done).toEqual([{ exitCode: 9 }])
    expect(ctx.snapshots.at(-1)).toEqual([expect.objectContaining({ state: "exited", exitCode: 9 })])
  })

  it("treats an already removed backend PTY as a successful close", async () => {
    const ctx = harness({ remove: async () => ({ error: { _tag: "PtyNotFoundError", status: 404 } }) })
    const done: unknown[] = []

    await ctx.manager.start("run", config, (exit) => done.push(exit))
    const terminalId = ctx.snapshots.at(-1)?.[0]?.terminalId
    if (!terminalId) throw new Error("missing Run terminal")

    expect(await ctx.manager.close(terminalId)).toBe(true)
    expect(done).toEqual([{ stopped: true }])
    expect(ctx.snapshots.at(-1)).toEqual([])
  })

  it("stops a PTY when stop races startup", async () => {
    const gate = deferred<PtyResponse>()
    const ctx = harness({ create: async () => gate.promise })
    const statuses: RunStatus[] = []
    const run = new RunScriptManager(
      () => undefined,
      (status) => statuses.push({ ...status }),
      () => new Date("2026-01-02T03:04:05.000Z"),
    )
    const started = run.start("wt-1", () => ctx.manager.start("run", config, (exit) => run.finish("wt-1", exit)))

    await wait()
    await run.stop("wt-1")
    gate.resolve({ data: { location: { directory: config.cwd }, data: info() } })
    await started
    await wait()

    expect(ctx.calls.remove).toEqual([{ ptyID: "pty-1", location: { directory: "/repo/worktree" } }])
    expect(statuses.map((status) => status.state)).toEqual(["running", "stopping", "idle"])
    expect(run.status("wt-1")).toMatchObject({ state: "idle", stopped: true })
  })

  it("intercepts resize and stops a running terminal when it closes", async () => {
    const ctx = harness()
    const done: unknown[] = []

    await ctx.manager.start("run", config, (exit) => done.push(exit))
    const terminalId = ctx.snapshots.at(-1)?.[0]?.terminalId
    if (!terminalId) throw new Error("missing Run terminal")
    expect(ctx.manager.intercept({ type: "agentManager.terminal.resize", terminalId, cols: 120, rows: 40 })).toBe(true)
    await wait()
    expect(ctx.calls.update).toEqual([
      { ptyID: "pty-1", location: { directory: "/repo/worktree" }, size: { cols: 120, rows: 40 } },
    ])

    expect(ctx.manager.intercept({ type: "agentManager.terminal.close", terminalId })).toBe(true)
    await wait()
    expect(ctx.calls.remove).toEqual([{ ptyID: "pty-1", location: { directory: "/repo/worktree" } }])
    expect(done).toEqual([{ stopped: true }])
    expect(ctx.closed).toEqual([terminalId])
    expect(ctx.snapshots.at(-1)).toEqual([])
  })

  it("retries closure after a Run terminal removal fails", async () => {
    let attempt = 0
    const ctx = harness({
      remove: async () => {
        attempt++
        if (attempt === 1) return { error: new Error("still running") }
        return { data: undefined }
      },
    })

    await ctx.manager.start("run", config, () => undefined)
    const terminalId = ctx.snapshots.at(-1)?.[0]?.terminalId
    if (!terminalId) throw new Error("missing Run terminal")
    expect(ctx.manager.intercept({ type: "agentManager.terminal.close", terminalId })).toBe(true)
    await wait()

    expect(ctx.closed).toEqual([])
    expect(ctx.snapshots.at(-1)).toEqual([expect.objectContaining({ terminalId, state: "failed" })])

    expect(ctx.manager.intercept({ type: "agentManager.terminal.close", terminalId })).toBe(true)
    await wait()

    expect(ctx.calls.remove).toHaveLength(2)
    expect(ctx.closed).toEqual([terminalId])
    expect(ctx.snapshots.at(-1)).toEqual([])
  })

  it("drops a retained Run terminal when the backend evicts it", async () => {
    const ctx = harness()
    const done: unknown[] = []

    await ctx.manager.start("run", config, (exit) => done.push(exit))
    ctx.manager.exited("pty-1", 0)
    ctx.manager.deleted("pty-1")

    expect(done).toEqual([{ exitCode: 0 }])
    expect(ctx.snapshots.at(-1)).toEqual([])
    expect(ctx.calls.remove).toEqual([])
  })

  it("reconciles a natural exit missed during an event-stream reconnect", async () => {
    let state: PtyInfo = info()
    const ctx = harness({ get: async () => ({ data: { location: { directory: config.cwd }, data: state } }) })
    const done: unknown[] = []

    await ctx.manager.start("run", config, (exit) => done.push(exit))
    state = info("exited", 23)
    await ctx.manager.sync()

    expect(done).toEqual([{ exitCode: 23 }])
    expect(ctx.snapshots.at(-1)).toEqual([expect.objectContaining({ state: "exited", exitCode: 23 })])
  })

  it("clears retained exited terminals by worktree context", async () => {
    const ctx = harness()

    await ctx.manager.start("run", config, () => undefined)
    ctx.manager.exited("pty-1", 0)

    expect(await ctx.manager.clear("run", "wt-1")).toBe(true)
    expect(ctx.calls.remove).toEqual([{ ptyID: "pty-1", location: { directory: "/repo/worktree" } }])
    expect(ctx.snapshots.at(-1)).toEqual([])
  })

  it("replays the full retained snapshot after a webview reload", async () => {
    const ctx = harness()

    await ctx.manager.start("run", config, () => undefined)
    const first = ctx.snapshots.at(-1)
    ctx.manager.snapshot()

    expect(ctx.snapshots.at(-1)).toEqual(first)
  })
})

describe("ScriptTerminalManager Setup kind", () => {
  it("creates a Setup PTY labeled Setup and tracks its kind", async () => {
    const ctx = harness()

    await ctx.manager.start("setup", config, () => undefined)

    expect(ctx.calls.create[0]?.title).toBe("Setup")
    expect(ctx.snapshots.at(-1)).toEqual([expect.objectContaining({ kind: "setup", title: "Setup", state: "running" })])
    expect(ctx.manager.active("setup", "wt-1")).toBe(true)
    expect(ctx.manager.active("run", "wt-1")).toBe(false)
  })

  it("ignores a user close while Setup is running", async () => {
    const ctx = harness()
    const done: unknown[] = []

    await ctx.manager.start("setup", config, (exit) => done.push(exit))
    const terminalId = ctx.snapshots.at(-1)?.[0]?.terminalId
    if (!terminalId) throw new Error("missing Setup terminal")

    expect(ctx.manager.intercept({ type: "agentManager.terminal.close", terminalId })).toBe(true)
    await wait()

    expect(ctx.calls.remove).toEqual([])
    expect(ctx.closed).toEqual([])
    expect(done).toEqual([])
    expect(ctx.snapshots.at(-1)).toEqual([expect.objectContaining({ terminalId, state: "running" })])
    expect(ctx.logs.some((msg) => msg.includes("Ignored close"))).toBe(true)
  })

  it("force-stops a running Setup when the worktree is cleared", async () => {
    const ctx = harness()
    const done: unknown[] = []

    await ctx.manager.start("setup", config, (exit) => done.push(exit))

    expect(await ctx.manager.clear("setup", "wt-1")).toBe(true)
    expect(ctx.calls.remove).toEqual([{ ptyID: "pty-1", location: { directory: "/repo/worktree" } }])
    expect(done).toEqual([{ stopped: true }])
    expect(ctx.snapshots.at(-1)).toEqual([])
    expect(ctx.manager.active("setup", "wt-1")).toBe(false)
  })

  it("closes an exited Setup terminal and reports inactive", async () => {
    const ctx = harness()
    const done: unknown[] = []

    await ctx.manager.start("setup", config, (exit) => done.push(exit))
    const terminalId = ctx.snapshots.at(-1)?.[0]?.terminalId
    if (!terminalId) throw new Error("missing Setup terminal")
    ctx.manager.exited("pty-1", 0)

    expect(ctx.manager.active("setup", "wt-1")).toBe(false)
    expect(await ctx.manager.close(terminalId)).toBe(true)
    expect(done).toEqual([{ exitCode: 0 }])
    expect(ctx.snapshots.at(-1)).toEqual([])
  })

  it("retains the tab as failed when killed, and survives the backend deleted event", async () => {
    let removes = 0
    const ctx = harness({
      remove: async () => {
        removes += 1
        // The first remove (the kill itself) succeeds; the PTY is gone for
        // any later remove, which must still close the retained tab.
        return removes > 1 ? { error: { _tag: "PtyNotFoundError" } } : { data: undefined }
      },
    })
    const done: unknown[] = []

    const handle = await ctx.manager.start("setup", config, (exit) => done.push(exit))
    const terminalId = ctx.snapshots.at(-1)?.[0]?.terminalId
    if (!terminalId) throw new Error("missing Setup terminal")

    handle.kill?.("Setup script timed out after 5 minutes")
    await wait()

    // The process tree is killed but the tab keeps its partial output.
    expect(ctx.calls.remove).toEqual([{ ptyID: "pty-1", location: { directory: "/repo/worktree" } }])
    expect(done).toEqual([{ error: "Setup script timed out after 5 minutes" }])
    expect(ctx.snapshots.at(-1)).toEqual([expect.objectContaining({ terminalId, state: "failed" })])

    // The backend confirming the deletion must not drop the retained tab.
    ctx.manager.deleted("pty-1")
    expect(ctx.snapshots.at(-1)).toEqual([expect.objectContaining({ terminalId, state: "failed" })])

    // Closing the retained tab still works when the PTY is already gone.
    expect(await ctx.manager.close(terminalId)).toBe(true)
    expect(ctx.snapshots.at(-1)).toEqual([])
  })

  it("stops a running Setup when the user deliberately stops it", async () => {
    const ctx = harness()
    const done: unknown[] = []

    await ctx.manager.start("setup", config, (exit) => done.push(exit))
    const terminalId = ctx.snapshots.at(-1)?.[0]?.terminalId
    if (!terminalId) throw new Error("missing Setup terminal")

    expect(ctx.manager.intercept({ type: "agentManager.terminal.stop", terminalId })).toBe(true)
    await wait()

    expect(ctx.calls.remove).toEqual([{ ptyID: "pty-1", location: { directory: "/repo/worktree" } }])
    expect(done).toEqual([{ stopped: true }])
    expect(ctx.closed).toEqual([terminalId])
    expect(ctx.snapshots.at(-1)).toEqual([])
  })
})
