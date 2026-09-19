import { describe, expect, it } from "bun:test"
import { openApprovalDiff, permissionAskDiffs, type PermissionAsk } from "../../src/kilo-provider/approval-diff"

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
    const seen = new Set<string>()
    const opened = openApprovalDiff(ask(), {
      diff: diff as never,
      directory: "/repo",
      seen,
      enabled: () => false,
      viewer: () => "kilo",
    })
    expect(opened).toBe(false)
    expect(diff.opened).toEqual([])
    expect(seen.size).toBe(0)
  })

  it("ignores non-edit tools like bash", () => {
    const diff = fakeDiff()
    const opened = openApprovalDiff(ask({ toolName: "bash" }), {
      diff: diff as never,
      directory: "/repo",
      seen: new Set(),
      enabled: () => true,
      viewer: () => "kilo",
    })
    expect(opened).toBe(false)
    expect(diff.opened).toEqual([])
  })

  it("opens the kilo viewer once per ask id", () => {
    const diff = fakeDiff()
    const seen = new Set<string>()
    const opts = {
      diff: diff as never,
      directory: "/repo",
      seen,
      enabled: () => true,
      viewer: () => "kilo" as const,
    }
    expect(openApprovalDiff(ask(), opts)).toBe(true)
    expect(diff.opened).toHaveLength(1)
    // Same id again: deduplicated.
    expect(openApprovalDiff(ask(), opts)).toBe(false)
    expect(diff.opened).toHaveLength(1)
    // New id: opens again.
    expect(openApprovalDiff(ask({ id: "perm_2" }), opts)).toBe(true)
    expect(diff.opened).toHaveLength(2)
  })

  it("groups multi-file patches into one diff", () => {
    const diff = fakeDiff()
    const multi = ask({
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
      seen: new Set(),
      enabled: () => true,
      viewer: () => "kilo",
    })
    const opened = diff.opened[0] as { file: string; files?: { file: string }[] }
    expect(opened.file).toBe("a.ts")
    expect(opened.files?.map((f) => f.file)).toEqual(["a.ts", "b.ts"])
  })

  it("routes to the native vscode viewer without the kilo provider", () => {
    const seen = new Set<string>()
    const opened = openApprovalDiff(ask(), {
      directory: "/repo",
      seen,
      enabled: () => true,
      viewer: () => "vscode",
    })
    expect(opened).toBe(true)
    expect(seen.has("perm_1")).toBe(true)
  })

  it("skips asks without a usable patch", () => {
    const diff = fakeDiff()
    const opened = openApprovalDiff(ask({ metadata: { filediff: { file: "x.ts", additions: 0, deletions: 0 } } }), {
      diff: diff as never,
      directory: "/repo",
      seen: new Set(),
      enabled: () => true,
      viewer: () => "kilo",
    })
    expect(opened).toBe(false)
    expect(diff.opened).toEqual([])
  })

  it("supports absolute Windows paths in filediff.file", async () => {
    const absolute = ask({
      metadata: {
        filepath: "C:\\Users\\dbabarik\\Desktop\\kilo-test\\kilo-readme.md",
        filediff: {
          file: "C:\\Users\\dbabarik\\Desktop\\kilo-test\\kilo-readme.md",
          patch: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n",
          additions: 1,
          deletions: 1,
        },
      },
    })
    const seen = new Set<string>()
    // The native viewer must not join the absolute path onto the directory
    // (regression: doubled `dir\ C:\dir\file` path from Uri.joinPath).
    expect(openApprovalDiff(absolute, { directory: "/repo", seen, enabled: () => true, viewer: () => "vscode" })).toBe(
      true,
    )
    await Bun.sleep(10)
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
    const seen = new Set<string>()
    const opts = {
      diff: panel as never,
      directory: "/repo",
      seen,
      enabled: () => true,
      viewer: () => "kilo" as const,
    }
    openApprovalDiff(ask({ id: "p1" }), opts)
    // A newer ask reuses the shared panel; the old ask's close must not fire.
    openApprovalDiff(ask({ id: "p2" }), opts)

    closeApprovalDiff("p1")
    expect(disposed).toEqual([])

    closeApprovalDiff("p2")
    expect(disposed).toEqual(["p2"])
  })

  it("closes the native diff tab opened for the ask", async () => {
    const { closeApprovalDiff } = await import("../../src/kilo-provider/approval-diff")
    const vscode = await import("vscode")
    const closed: unknown[] = []
    // Structural URI match (scheme/path/query) mirrors closeApprovalDiff.
    // Built with the same mock Uri.from call the production code uses, so
    // path normalization differences (leading slash) can't break the match.
    const openedUri = vscode.Uri.from({
      scheme: "kilo-code-new-approval-diff",
      path: vscode.Uri.file("src/app.ts").path,
      query: encodeURIComponent("perm_1"),
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

    // Open the native viewer for perm_1, then reply.
    openApprovalDiff(ask(), {
      directory: "/repo",
      seen: new Set(),
      enabled: () => true,
      viewer: () => "vscode",
    })
    await Bun.sleep(10)
    closeApprovalDiff("perm_1")
    expect(closed).toHaveLength(1)

    // Unknown ids are ignored.
    closeApprovalDiff("never_opened")
    expect(closed).toHaveLength(1)
  })
})
