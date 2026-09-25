import { describe, expect, it } from "bun:test"
import {
  approvalDiffScheme,
  closeApprovalDiff,
  openApprovalDiff,
  permissionAskDiffs,
  type PermissionAsk,
} from "../../src/kilo-provider/approval-diff"

function ask(overrides: Partial<PermissionAsk> = {}): PermissionAsk {
  return {
    id: "perm_1",
    sessionID: "ses_1",
    toolName: "edit",
    metadata: {
      filepath: "src/app.ts",
      filediff: {
        file: "src/app.ts",
        patch: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
        additions: 1,
        deletions: 1,
      },
    },
    ...overrides,
  }
}

function fakeDiff() {
  const opened: unknown[] = []
  return {
    opened,
    open: (diff: unknown) => opened.push(diff),
  }
}

// Unique ask ids per test: dedup is now module-level, so ids must not repeat
// across tests the way per-instance sets allowed.
let seq = 0
function freshId() {
  seq += 1
  return `perm_${seq}`
}

describe("permissionAskDiffs", () => {
  it("extracts a direct filediff", () => {
    expect(permissionAskDiffs(ask())).toEqual([
      {
        file: "src/app.ts",
        patch: expect.stringContaining("+new"),
        additions: 1,
        deletions: 1,
      },
    ])
  })

  it("extracts apply_patch style files[] entries", () => {
    const result = permissionAskDiffs(
      ask({
        metadata: {
          files: [
            { relativePath: "a.ts", patch: "patch-a", additions: 1, deletions: 0 },
            { relativePath: "b.ts", patch: "patch-b", additions: 0, deletions: 1 },
          ],
        },
      }),
    )
    expect(result.map((d) => d.file)).toEqual(["a.ts", "b.ts"])
  })

  it("falls back to args.diff raw patch text", () => {
    const result = permissionAskDiffs(ask({ metadata: { diff: "raw patch", filepath: "src/x.ts" } }))
    expect(result).toEqual([{ file: "src/x.ts", patch: "raw patch", additions: 0, deletions: 0 }])
  })

  it("returns empty for asks without diff metadata", () => {
    expect(permissionAskDiffs(ask({ metadata: {} }))).toEqual([])
  })
})

describe("openApprovalDiff", () => {
  it("does nothing when disabled", () => {
    const diff = fakeDiff()
    const opened = openApprovalDiff(ask({ id: freshId() }), {
      diff: diff as never,
      directory: "/repo",
      enabled: () => false,
      viewer: () => "kilo",
    })
    expect(opened).toBe(false)
    expect(diff.opened).toEqual([])
  })

  it("ignores non-edit tools like bash", () => {
    const diff = fakeDiff()
    const opened = openApprovalDiff(ask({ id: freshId(), toolName: "bash" }), {
      diff: diff as never,
      directory: "/repo",
      enabled: () => true,
      viewer: () => "kilo",
    })
    expect(opened).toBe(false)
    expect(diff.opened).toEqual([])
  })

  it("opens the kilo viewer once per ask id, even across separate callers", () => {
    const diff = fakeDiff()
    const id = freshId()
    const opts = {
      diff: diff as never,
      directory: "/repo",
      enabled: () => true,
      viewer: () => "kilo" as const,
    }
    expect(openApprovalDiff(ask({ id }), opts)).toBe(true)
    expect(diff.opened).toHaveLength(1)
    // Same id again, from a different provider instance: still deduplicated —
    // the seen set is module-level because one ask reaches several providers.
    const other = fakeDiff()
    expect(openApprovalDiff(ask({ id }), { ...opts, diff: other as never })).toBe(false)
    expect(other.opened).toEqual([])
    // New id: opens again.
    expect(openApprovalDiff(ask({ id: freshId() }), opts)).toBe(true)
    expect(diff.opened).toHaveLength(2)
  })

  it("groups multi-file patches into one diff", () => {
    const diff = fakeDiff()
    const multi = ask({
      id: freshId(),
      metadata: {
        files: [
          { relativePath: "a.ts", patch: "patch-a", additions: 1, deletions: 0 },
          { relativePath: "b.ts", patch: "patch-b", additions: 0, deletions: 1 },
        ],
      },
    })
    openApprovalDiff(multi, {
      diff: diff as never,
      directory: "/repo",
      enabled: () => true,
      viewer: () => "kilo",
    })
    const opened = diff.opened[0] as { file: string; files?: { file: string }[] }
    expect(opened.file).toBe("a.ts")
    expect(opened.files?.map((f) => f.file)).toEqual(["a.ts", "b.ts"])
  })

  it("routes to the native vscode viewer without the kilo provider", async () => {
    const opened = openApprovalDiff(ask({ id: freshId() }), {
      directory: "/repo",
      enabled: () => true,
      viewer: () => "vscode",
    })
    expect(opened).toBe(true)
  })

  it("opens one native diff per file of a multi-file ask", async () => {
    const vscode = await import("vscode")
    const ran: string[] = []
    const original = vscode.commands.executeCommand
    ;(vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = async (
      command: string,
      ...args: unknown[]
    ) => {
      if (command === "vscode.diff") ran.push(String((args[1] as { path?: string }).path))
      return undefined
    }
    const multi = ask({
      id: freshId(),
      metadata: {
        files: [
          {
            relativePath: "a.ts",
            patch: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
            additions: 1,
            deletions: 0,
          },
          {
            relativePath: "b.ts",
            patch: "--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-old\n+new\n",
            additions: 0,
            deletions: 1,
          },
        ],
      },
    })
    expect(openApprovalDiff(multi, { directory: "/repo", enabled: () => true, viewer: () => "vscode" })).toBe(true)
    await Bun.sleep(10)
    expect(ran).toHaveLength(2)
    // Replying must evict every file's cached contents — the registry stores
    // all URIs of the ask, not just the first file's. Build each URI the same
    // way cache() does (mock Uri.file adds no leading slash).
    const { approvalDiffContentProvider } = await import("../../src/kilo-provider/approval-diff")
    const content = (file: string) =>
      approvalDiffContentProvider.provideTextDocumentContent(
        vscode.Uri.from({
          scheme: approvalDiffScheme(),
          path: vscode.Uri.file(file).path,
          query: encodeURIComponent(multi.id),
        }) as never,
      )
    closeApprovalDiff(multi.id)
    expect(content("a.ts")).toBe("")
    expect(content("b.ts")).toBe("")
    ;(vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = original
  })

  it("closes every native tab of a multi-file ask on reply", async () => {
    const vscode = await import("vscode")
    const closed: string[] = []
    const originalTabGroups = vscode.window.tabGroups
    let askId = ""
    const tabGroupsStub = {
      all: [
        {
          tabs: ["a", "b", "c"].map((f) => ({
            input: new vscode.TabInputTextDiff(
              { scheme: "file", path: `/repo/${f}.ts` } as never,
              {
                scheme: approvalDiffScheme(),
                path: `${f}.ts`,
                query: "",
                get ask() {
                  return askId
                },
              } as never,
            ),
          })),
        },
      ],
      close: (async (tab: { input: { modified: { path?: string; query?: string } } }) => {
        closed.push(`${tab.input.modified.path}?${tab.input.modified.query ?? ""}`)
      }) as never,
    } as never
    ;(vscode.window as unknown as { tabGroups: typeof originalTabGroups }).tabGroups = tabGroupsStub
    const multi = ask({
      id: freshId(),
      metadata: {
        files: [
          {
            relativePath: "a.ts",
            patch: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
            additions: 1,
            deletions: 0,
          },
          {
            relativePath: "b.ts",
            patch: "--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-old\n+new\n",
            additions: 0,
            deletions: 1,
          },
        ],
      },
    })
    expect(openApprovalDiff(multi, { directory: "/repo", enabled: () => true, viewer: () => "vscode" })).toBe(true)
    await Bun.sleep(10)
    // Stamp the ask's query onto the a/b tabs so closeApprovalDiff's
    // scheme+path+query match finds exactly a and b (c is untouched).
    try {
      const askQuery = encodeURIComponent(multi.id)
      for (const tab of tabGroupsStub.all[0]!.tabs) {
        const modified = (tab.input as unknown as { modified: { path: string; query: string } }).modified
        if (modified.path !== "c.ts") modified.query = askQuery
      }
      closeApprovalDiff(multi.id)
      // a.ts and b.ts tabs are closed; c.ts (not part of the ask) survives.
      expect(closed.sort()).toEqual([`a.ts?${askQuery}`, `b.ts?${askQuery}`])
    } finally {
      ;(vscode.window as unknown as { tabGroups: typeof originalTabGroups }).tabGroups = originalTabGroups
    }
  })

  it("skips asks without a usable patch", () => {
    const diff = fakeDiff()
    const opened = openApprovalDiff(
      ask({ id: freshId(), metadata: { filediff: { file: "x.ts", additions: 0, deletions: 0 } } }),
      {
        diff: diff as never,
        directory: "/repo",
        enabled: () => true,
        viewer: () => "kilo",
      },
    )
    expect(opened).toBe(false)
    expect(diff.opened).toEqual([])
  })

  it("supports absolute Windows paths in filediff.file", async () => {
    const vscode = await import("vscode")
    const ran: string[] = []
    const original = vscode.commands.executeCommand
    ;(vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = async (
      command: string,
      ...args: unknown[]
    ) => {
      if (command === "vscode.diff") ran.push(String((args[0] as { fsPath?: string }).fsPath))
      return undefined
    }
    const absolute = ask({
      id: freshId(),
      metadata: {
        filepath: "C:\\Users\\dev\\projects\\demo\\README.md",
        filediff: {
          file: "C:\\Users\\dev\\projects\\demo\\README.md",
          patch: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n",
          additions: 1,
          deletions: 1,
        },
      },
    })
    // Regression: the native viewer must not join the absolute path onto the
    // directory (doubled `dir\C:\dir\file` from Uri.joinPath); the left side
    // passed to vscode.diff must be the absolute path as-is.
    expect(openApprovalDiff(absolute, { directory: "/repo", enabled: () => true, viewer: () => "vscode" })).toBe(true)
    await Bun.sleep(10)
    expect(ran).toHaveLength(1)
    // Backslashes must survive: the exact absolute path, not a joined one.
    expect(ran[0]).toBe(["C:", "Users", "dev", "projects", "demo", "README.md"].join("\\"))
    ;(vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = original
  })

  it("renders hunks only when the patch does not apply to the drifted file", async () => {
    const vscode = await import("vscode")
    const uri = {
      scheme: "kilo-code-new-approval-diff",
      path: vscode.Uri.file("src/app.ts").path,
      query: encodeURIComponent("drift_" + freshId()),
    }
    // Run after openApprovalDiff cached the contents for the drifted file.
    const provided = (await import("../../src/kilo-provider/approval-diff")).approvalDiffContentProvider
    const drifted = ask({
      id: uri.query,
      metadata: {
        filepath: "src/app.ts",
        filediff: {
          file: "src/app.ts",
          patch: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-different\n+new\n",
          additions: 1,
          deletions: 1,
        },
      },
    })
    expect(openApprovalDiff(drifted, { directory: "/repo", enabled: () => true, viewer: () => "vscode" })).toBe(true)
    await Bun.sleep(10)
    const after = provided.provideTextDocumentContent(vscode.Uri.from(uri) as never)
    // Hunk fallback strips the +/- prefixes; the proposed line must survive.
    expect(after).toContain("new")
  })
})

describe("closeApprovalDiff", () => {
  it("closes the kilo panel the ask opened, but not a newer diff", async () => {
    const { closeApprovalDiff } = await import("../../src/kilo-provider/approval-diff")
    const disposed: string[] = []
    const panel = {
      open: (diff: { askID?: string }) => {
        current = diff.askID
      },
      closeIfCurrent: (askID: string) => {
        if (current === askID) disposed.push(askID)
      },
    }
    let current: string | undefined
    const opts = {
      diff: panel as never,
      directory: "/repo",
      enabled: () => true,
      viewer: () => "kilo" as const,
    }
    const first = freshId()
    const second = freshId()
    openApprovalDiff(ask({ id: first }), opts)
    // A newer ask reuses the shared panel; the old ask's close must not fire.
    openApprovalDiff(ask({ id: second }), opts)

    closeApprovalDiff(first)
    expect(disposed).toEqual([])

    closeApprovalDiff(second)
    expect(disposed).toEqual([second])
  })

  it("closes the native diff tab opened for the ask and evicts its cached contents", async () => {
    const { closeApprovalDiff, approvalDiffContentProvider } = await import("../../src/kilo-provider/approval-diff")
    const vscode = await import("vscode")
    const closed: unknown[] = []
    const id = freshId()
    // Structural URI match (scheme/path/query) mirrors closeApprovalDiff.
    // Built with the same mock Uri.from call the production code uses, so
    // path normalization differences (leading slash) can't break the match.
    const openedUri = vscode.Uri.from({
      scheme: "kilo-code-new-approval-diff",
      path: vscode.Uri.file("src/app.ts").path,
      query: encodeURIComponent(id),
    })
    ;(
      vscode.window.tabGroups as unknown as {
        all: Array<{ tabs: Array<{ input: unknown }> }>
        close: (tab: unknown) => Promise<void>
      }
    ).all = [
      {
        tabs: [
          {
            input: new (vscode.TabInputTextDiff as unknown as new (a: unknown, b: unknown) => never)(
              { toString: () => "file:/repo/src/app.ts" },
              openedUri,
            ),
          },
        ],
      },
    ]
    ;(vscode.window.tabGroups as unknown as { close: (tab: unknown) => Promise<void> }).close = async (tab) => {
      closed.push(tab)
    }

    // Open the native viewer, wait for contents, then reply.
    openApprovalDiff(ask({ id }), {
      directory: "/repo",
      enabled: () => true,
      viewer: () => "vscode",
    })
    await Bun.sleep(10)
    expect(approvalDiffContentProvider.provideTextDocumentContent(vscode.Uri.from(openedUri) as never)).toContain("new")
    closeApprovalDiff(id)
    expect(closed).toHaveLength(1)
    // The cached virtual contents are evicted with the tab (no leak).
    expect(approvalDiffContentProvider.provideTextDocumentContent(vscode.Uri.from(openedUri) as never)).toBe("")

    // Unknown ids are ignored.
    closeApprovalDiff("never_opened")
    expect(closed).toHaveLength(1)
  })

  it("closes a native viewer whose reply raced the content read", async () => {
    const { closeApprovalDiff } = await import("../../src/kilo-provider/approval-diff")
    const vscode = await import("vscode")
    const id = freshId()
    const closed: string[] = []
    // readFile hangs until the reply arrives, so the open is still pending
    // when closeApprovalDiff runs — the reserved entry must still be found.
    const release = Promise.withResolvers<void>()
    const originalRead = vscode.workspace.fs.readFile
    ;(vscode.workspace.fs as unknown as { readFile: typeof vscode.workspace.fs.readFile }).readFile = () =>
      new Promise((resolve) => {
        void release.promise.then(() => resolve(new TextEncoder().encode("old")))
      }) as never
    const originalClose = (vscode.window.tabGroups as unknown as { close: (tab: unknown) => Promise<void> }).close
    ;(vscode.window.tabGroups as unknown as { close: (tab: unknown) => Promise<void> }).close = async (tab) => {
      closed.push(String((tab as { input?: { modified?: { query?: string } } }).input?.modified?.query))
      await originalClose(tab)
    }

    expect(openApprovalDiff(ask({ id }), { directory: "/repo", enabled: () => true, viewer: () => "vscode" })).toBe(
      true,
    )
    // Reply arrives while contents() is still awaiting readFile.
    closeApprovalDiff(id)
    release.resolve()
    await Bun.sleep(10)
    // The tab never opened (replied first), and nothing was cached.
    expect(closed).toEqual([])
    ;(vscode.workspace.fs as unknown as { readFile: typeof vscode.workspace.fs.readFile }).readFile = originalRead
    ;(vscode.window.tabGroups as unknown as { close: (tab: unknown) => Promise<void> }).close = originalClose
  })

  it("rolls back the reserved native entry when show() rejects", async () => {
    const vscode = await import("vscode")
    const id = freshId()
    // readFile resolves, then executeCommand throws — show() rejects after
    // the reservation, and the catch must evict the ask from the maps.
    const originalRead = vscode.workspace.fs.readFile
    ;(vscode.workspace.fs as unknown as { readFile: typeof vscode.workspace.fs.readFile }).readFile = async () =>
      new TextEncoder().encode("old")
    const originalExec = vscode.commands.executeCommand
    ;(vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
      async () => {
        throw new Error("boom")
      }
    const { closeApprovalDiff, approvalDiffContentProvider } = await import("../../src/kilo-provider/approval-diff")
    try {
      expect(openApprovalDiff(ask({ id }), { directory: "/repo", enabled: () => true, viewer: () => "vscode" })).toBe(
        true,
      )
      await Bun.sleep(10)
      // The ask was rolled back: closing it again must be a no-op (entry
      // gone), the cached contents must be evicted (not just the maps), and
      // re-opening with the same id must work (seen was cleared).
      closeApprovalDiff(id)
      const cached = (file: string) =>
        approvalDiffContentProvider.provideTextDocumentContent(
          vscode.Uri.from({
            scheme: approvalDiffScheme(),
            path: vscode.Uri.file(file).path,
            query: encodeURIComponent(id),
          }) as never,
        )
      expect(cached("src/app.ts")).toBe("")
      const again = ask({
        id,
        metadata: {
          filediff: {
            file: "y.ts",
            patch: "--- a/y.ts\n+++ b/y.ts\n@@ -1 +1 @@\n-old\n+new\n",
            additions: 1,
            deletions: 0,
          },
        },
      })
      expect(openApprovalDiff(again, { directory: "/repo", enabled: () => true, viewer: () => "vscode" })).toBe(true)
    } finally {
      ;(vscode.workspace.fs as unknown as { readFile: typeof vscode.workspace.fs.readFile }).readFile = originalRead
      ;(vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
        originalExec
    }
  })

  it("stops opening remaining files when a reply lands mid-loop", async () => {
    const vscode = await import("vscode")
    const { closeApprovalDiff } = await import("../../src/kilo-provider/approval-diff")
    const id = freshId()
    const ran: string[] = []
    const originalRead = vscode.workspace.fs.readFile
    ;(vscode.workspace.fs as unknown as { readFile: typeof vscode.workspace.fs.readFile }).readFile = async () =>
      new TextEncoder().encode("old")
    const originalExec = vscode.commands.executeCommand
    ;(vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = async (
      command: string,
      ...args: unknown[]
    ) => {
      if (command === "vscode.diff") {
        ran.push(String((args[1] as { path?: string }).path))
        // Reply arrives after the first file's tab opens — mid-loop.
        if (ran.length === 1) closeApprovalDiff(id)
      }
      return undefined
    }
    try {
      const multi = ask({
        id,
        metadata: {
          files: [
            {
              relativePath: "a.ts",
              patch: ["--- a/a.ts", "+++ b/a.ts", "@@ -1 +1 @@", "-old", "+new"].join("\n") + "\n",
              additions: 1,
              deletions: 0,
            },
            {
              relativePath: "b.ts",
              patch: ["--- a/b.ts", "+++ b/b.ts", "@@ -1 +1 @@", "-old", "+new"].join("\n") + "\n",
              additions: 0,
              deletions: 1,
            },
          ],
        },
      })
      expect(openApprovalDiff(multi, { directory: "/repo", enabled: () => true, viewer: () => "vscode" })).toBe(true)
      await Bun.sleep(10)
      // Only the first file opened; the loop stopped once the reply landed.
      expect(ran).toEqual(["a.ts"])
    } finally {
      ;(vscode.workspace.fs as unknown as { readFile: typeof vscode.workspace.fs.readFile }).readFile = originalRead
      ;(vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
        originalExec
    }
  })
})
