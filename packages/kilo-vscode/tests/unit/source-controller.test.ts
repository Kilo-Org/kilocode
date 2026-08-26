import { describe, it, expect } from "bun:test"
import { SourceController } from "../../src/diff/SourceController"
import type { DiffSource, DiffSourceDescriptor, DiffSourceFetch } from "../../src/diff/sources/types"

const WORKSPACE_DESC: DiffSourceDescriptor = {
  id: "workspace",
  type: "workspace",
  group: "Git",
  capabilities: { revert: true, comments: true },
}

const SESSION_DESC: DiffSourceDescriptor = {
  id: "session:s1",
  type: "session",
  group: "Session",
  capabilities: { revert: false, comments: true },
}

function make(sources: Record<string, DiffSource>, descriptors?: DiffSourceDescriptor[]) {
  const posted: unknown[] = []
  const controller = new SourceController(
    (id) => {
      const src = sources[id]
      if (!src) throw new Error(`no source: ${id}`)
      return src
    },
    () => descriptors ?? Object.values(sources).map((s) => s.descriptor),
    (m) => posted.push(m),
  )
  return { controller, posted }
}

const byType = (posted: unknown[], type: string) =>
  posted.filter((m): m is Record<string, unknown> => {
    return typeof m === "object" && m !== null && (m as { type: string }).type === type
  })

describe("SourceController.activate", () => {
  it("builds, fetches, and posts available sources + capabilities + diffs", async () => {
    let fetches = 0
    const source: DiffSource = {
      descriptor: SESSION_DESC,
      async fetch(): Promise<DiffSourceFetch> {
        fetches++
        return { diffs: [] }
      },
    }
    const { controller, posted } = make({ "session:s1": source }, [WORKSPACE_DESC, SESSION_DESC])

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("session:s1")

    expect(fetches).toBe(1)
    expect(controller.currentId).toBe("session:s1")

    const available = byType(posted, "setAvailableSources")
    expect(available).toHaveLength(1)
    expect(available[0]!.currentId).toBe("session:s1")
    expect(available[0]!.descriptors).toEqual([WORKSPACE_DESC, SESSION_DESC])

    const caps = byType(posted, "diffViewer.capabilities")
    expect(caps).toHaveLength(1)
    expect(caps[0]!.capabilities).toEqual({ revert: false, comments: true })

    const diffs = byType(posted, "diffViewer.diffs")
    expect(diffs).toHaveLength(1)
    expect(diffs[0]!.diffs).toEqual([])

    const loading = byType(posted, "diffViewer.loading")
    expect(loading.map((m) => m.loading)).toEqual([true, false])

    // Clean up the polling interval scheduled by activate().
    controller.stop()
  })

  it("forwards notices from the source to the webview", async () => {
    const source: DiffSource = {
      descriptor: SESSION_DESC,
      async fetch() {
        return { diffs: [], notice: "snapshots-disabled", stopPolling: true }
      },
    }
    const { controller, posted } = make({ "session:s1": source })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("session:s1")

    const notices = byType(posted, "diffViewer.notice")
    expect(notices).toHaveLength(1)
    expect(notices[0]!.notice).toBe("snapshots-disabled")
  })

  it("disposes the previous source when activating a new one", async () => {
    let workspaceDisposed = 0
    const workspace: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async fetch() {
        return { diffs: [] }
      },
      dispose() {
        workspaceDisposed++
      },
    }
    let sessionFetches = 0
    const session: DiffSource = {
      descriptor: SESSION_DESC,
      async fetch() {
        sessionFetches++
        return { diffs: [] }
      },
    }
    const { controller } = make({ workspace, "session:s1": session })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("workspace")
    await controller.activate("session:s1")

    expect(workspaceDisposed).toBe(1)
    expect(sessionFetches).toBe(1)
    expect(controller.currentId).toBe("session:s1")

    controller.stop()
  })

  it("drops a fetch result and disposes the source when stopped mid-fetch", async () => {
    let release: () => void = () => {}
    let fetches = 0
    let disposed = 0
    const session: DiffSource = {
      descriptor: SESSION_DESC,
      async fetch() {
        fetches++
        await new Promise<void>((r) => (release = r))
        return { diffs: [] }
      },
      dispose() {
        disposed++
      },
    }
    const { controller, posted } = make({ "session:s1": session })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    const activation = controller.activate("session:s1")
    controller.stop()
    release()
    await activation

    expect(fetches).toBe(1)
    expect(disposed).toBe(1)
    // Fetch resolved after stop — its diffs must not leak to the webview.
    expect(byType(posted, "diffViewer.diffs")).toEqual([])
  })

  it("drops a fetch result from a source that has been swapped out", async () => {
    let release: () => void = () => {}
    const workspace: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async fetch() {
        await new Promise<void>((r) => (release = r))
        return { diffs: [{ file: "stale.ts" } as never] }
      },
    }
    const session: DiffSource = {
      descriptor: SESSION_DESC,
      async fetch() {
        return { diffs: [] }
      },
    }
    const { controller, posted } = make({ workspace, "session:s1": session })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    const first = controller.activate("workspace")
    await controller.activate("session:s1")
    release()
    await first

    const diffs = byType(posted, "diffViewer.diffs")
    // Only the session source's empty diffs should have been posted.
    expect(diffs).toHaveLength(1)
    expect(diffs[0]!.diffs).toEqual([])

    controller.stop()
  })
})

describe("SourceController.stop", () => {
  it("disposes the active source", async () => {
    let disposed = 0
    const session: DiffSource = {
      descriptor: SESSION_DESC,
      async fetch() {
        return { diffs: [] }
      },
      dispose() {
        disposed++
      },
    }
    const { controller } = make({ "session:s1": session })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("session:s1")

    controller.stop()

    expect(disposed).toBe(1)
    expect(controller.currentId).toBeUndefined()
  })

  it("is a no-op when no source is active", () => {
    const { controller } = make({})
    controller.stop()
    expect(controller.currentId).toBeUndefined()
  })
})

describe("SourceController.revertFile", () => {
  it("posts error when the active source does not support revert", async () => {
    const session: DiffSource = {
      descriptor: SESSION_DESC,
      async fetch() {
        return { diffs: [] }
      },
    }
    const { controller, posted } = make({ "session:s1": session })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("session:s1")
    posted.length = 0
    await controller.revertFile("foo.ts")

    const results = byType(posted, "diffViewer.revertFileResult")
    expect(results).toHaveLength(1)
    expect(results[0]!.status).toBe("error")
    expect(results[0]!.file).toBe("foo.ts")

    controller.stop()
  })

  it("posts success from a successful revert and triggers a fresh fetch", async () => {
    const reverts: string[] = []
    let fetches = 0
    const workspace: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async fetch() {
        fetches++
        return { diffs: [] }
      },
      async revert(file) {
        reverts.push(file)
        return { ok: true, message: "Reverted" }
      },
    }
    const { controller, posted } = make({ workspace })

    controller.setContext({ workspaceRoot: "/repo" })
    await controller.activate("workspace")
    const fetchesAfterActivate = fetches
    posted.length = 0
    await controller.revertFile("foo.ts")

    expect(reverts).toEqual(["foo.ts"])
    const results = byType(posted, "diffViewer.revertFileResult")
    expect(results[0]!.status).toBe("success")
    expect(results[0]!.message).toBe("Reverted")
    // Successful revert triggers an immediate re-fetch to push updated diffs.
    expect(fetches).toBe(fetchesAfterActivate + 1)

    controller.stop()
  })

  it("posts error when the revert implementation throws", async () => {
    const workspace: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async fetch() {
        return { diffs: [] }
      },
      async revert() {
        throw new Error("boom")
      },
    }
    const { controller, posted } = make({ workspace })

    controller.setContext({ workspaceRoot: "/repo" })
    await controller.activate("workspace")
    posted.length = 0
    await controller.revertFile("foo.ts")

    const results = byType(posted, "diffViewer.revertFileResult")
    expect(results[0]!.status).toBe("error")
    expect(results[0]!.message).toBe("boom")

    controller.stop()
  })
})

describe("SourceController.requestFile", () => {
  it("posts null when the source does not support per-file detail", async () => {
    const session: DiffSource = {
      descriptor: SESSION_DESC,
      async fetch() {
        return { diffs: [] }
      },
    }
    const { controller, posted } = make({ "session:s1": session })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("session:s1")
    posted.length = 0
    await controller.requestFile("foo.ts")

    const files = byType(posted, "diffViewer.diffFile")
    expect(files).toHaveLength(1)
    expect(files[0]!.file).toBe("foo.ts")
    expect(files[0]!.diff).toBeNull()

    controller.stop()
  })

  it("forwards the source's fetchFile result", async () => {
    const detail = {
      file: "foo.ts",
      before: "a",
      after: "b",
      additions: 1,
      deletions: 1,
    }
    const workspace: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async fetch() {
        return { diffs: [] }
      },
      async fetchFile(file) {
        return file === "foo.ts" ? detail : null
      },
    }
    const { controller, posted } = make({ workspace })

    controller.setContext({ workspaceRoot: "/repo" })
    await controller.activate("workspace")
    posted.length = 0
    await controller.requestFile("foo.ts")

    const files = byType(posted, "diffViewer.diffFile")
    expect(files[0]!.diff).toEqual(detail)

    controller.stop()
  })

  it("does not start queued detail work after the source changes", async () => {
    let details = 0
    const workspace: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async fetch() {
        return { diffs: [] }
      },
      async fetchFile() {
        details++
        return null
      },
    }
    const session: DiffSource = {
      descriptor: SESSION_DESC,
      async fetch() {
        return { diffs: [] }
      },
    }
    const { controller } = make({ workspace, "session:s1": session })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("workspace")
    const request = controller.requestFile("foo.ts")
    await controller.activate("session:s1")
    await request

    expect(details).toBe(0)
    controller.stop()
  })

  it("posts null when a pending fetchFile result is invalidated by stop", async () => {
    let release: () => void = () => {}
    const workspace: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async fetch() {
        return { diffs: [] }
      },
      async fetchFile() {
        await new Promise<void>((resolve) => (release = resolve))
        return {
          file: "foo.ts",
          before: "a",
          after: "b",
          additions: 1,
          deletions: 1,
        }
      },
    }
    const { controller, posted } = make({ workspace })

    controller.setContext({ workspaceRoot: "/repo" })
    await controller.activate("workspace")
    posted.length = 0
    const request = controller.requestFile("foo.ts")
    controller.stop()
    release()
    await request

    const files = byType(posted, "diffViewer.diffFile")
    expect(files).toHaveLength(1)
    expect(files[0]!.file).toBe("foo.ts")
    expect(files[0]!.diff).toBeNull()
  })
})

describe("SourceController.requestFiles", () => {
  it("loads unique files in one source request and emits existing detail messages", async () => {
    const calls: string[][] = []
    const source: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async fetch() {
        return { diffs: [] }
      },
      async fetchFiles(files) {
        calls.push([...files])
        return {
          entries: new Map(
            files.map((file) => [file, { file, before: "old", after: "new", additions: 1, deletions: 1 }]),
          ),
          deferred: new Set(),
        }
      },
    }
    const { controller, posted } = make({ workspace: source })
    controller.setContext({ workspaceRoot: "/repo" })
    await controller.activate("workspace")
    posted.length = 0
    await controller.requestFiles(["one.ts", "two.ts", "one.ts"])

    expect(calls).toEqual([["one.ts", "two.ts"]])
    const messages = byType(posted, "diffViewer.diffFile")
    expect(messages.map((message) => message.file)).toEqual(["one.ts", "two.ts"])
    expect(messages.every((message) => message.diff !== null)).toBe(true)
    controller.stop()
  })

  it("loads explicitly deferred bulk entries without retrying failed files", async () => {
    const calls: string[] = []
    const source: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async fetch() {
        return { diffs: [] }
      },
      async fetchFiles(files) {
        return {
          entries: new Map([
            [files[0]!, { file: files[0]!, before: "old", after: "new", additions: 1, deletions: 1 }],
            ["failed.ts", null],
          ]),
          deferred: new Set(files.slice(1).filter((file) => file !== "failed.ts")),
        }
      },
      async fetchFile(file) {
        calls.push(file)
        return { file, before: "old", after: "new", additions: 1, deletions: 1 }
      },
    }
    const { controller, posted } = make({ workspace: source })
    controller.setContext({ workspaceRoot: "/repo" })
    await controller.activate("workspace")
    posted.length = 0
    await controller.requestFiles(["one.ts", "two.ts", "three.ts", "failed.ts"])

    expect(calls).toEqual(["two.ts", "three.ts"])
    const messages = byType(posted, "diffViewer.diffFile")
    expect(messages.map((message) => message.file)).toEqual(["one.ts", "two.ts", "three.ts", "failed.ts"])
    expect(messages.slice(0, 3).every((message) => message.diff !== null)).toBe(true)
    expect(messages[3]!.diff).toBeNull()
    controller.stop()
  })

  it("falls back to singular details when a bulk source fails", async () => {
    const calls: string[] = []
    const source: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async fetch() {
        return { diffs: [] }
      },
      async fetchFiles() {
        throw new Error("batch failed")
      },
      async fetchFile(file) {
        calls.push(file)
        return { file, before: "old", after: "new", additions: 1, deletions: 1 }
      },
    }
    const { controller, posted } = make({ workspace: source })
    controller.setContext({ workspaceRoot: "/repo" })
    await controller.activate("workspace")
    posted.length = 0
    await controller.requestFiles(["one.ts", "two.ts"])

    expect(calls).toEqual(["one.ts", "two.ts"])
    expect(byType(posted, "diffViewer.diffFile").every((message) => message.diff !== null)).toBe(true)
    controller.stop()
  })

  it("uses singular loading for sources without a bulk implementation", async () => {
    const calls: string[] = []
    const source: DiffSource = {
      descriptor: SESSION_DESC,
      async fetch() {
        return { diffs: [] }
      },
      async fetchFile(file) {
        calls.push(file)
        return { file, before: "old", after: "new", additions: 1, deletions: 1 }
      },
    }
    const { controller, posted } = make({ "session:s1": source })
    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("session:s1")
    posted.length = 0
    await controller.requestFiles(["one.ts", "two.ts"])

    expect(calls).toEqual(["one.ts", "two.ts"])
    expect(byType(posted, "diffViewer.diffFile")).toHaveLength(2)
    controller.stop()
  })

  it("does not start queued bulk work after switching sources", async () => {
    const calls: string[][] = []
    const workspace: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async fetch() {
        return { diffs: [] }
      },
      async fetchFiles(files) {
        calls.push([...files])
        return { entries: new Map(), deferred: new Set() }
      },
    }
    const session: DiffSource = {
      descriptor: SESSION_DESC,
      async fetch() {
        return { diffs: [] }
      },
    }
    const { controller, posted } = make({ workspace, "session:s1": session })
    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("workspace")
    posted.length = 0
    const request = controller.requestFiles(["one.ts", "two.ts"])
    await controller.activate("session:s1")
    await request

    expect(calls).toEqual([])
    const messages = byType(posted, "diffViewer.diffFile")
    expect(messages.map((message) => message.file)).toEqual(["one.ts", "two.ts"])
    expect(messages.every((message) => message.diff === null)).toBe(true)
    controller.stop()
  })

  it("completes every pending file with null when the source stops", async () => {
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const source: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async fetch() {
        return { diffs: [] }
      },
      async fetchFiles(files) {
        started()
        await gate
        return {
          entries: new Map(
            files.map((file) => [file, { file, before: "old", after: "new", additions: 1, deletions: 1 }]),
          ),
          deferred: new Set(),
        }
      },
    }
    const { controller, posted } = make({ workspace: source })
    controller.setContext({ workspaceRoot: "/repo" })
    await controller.activate("workspace")
    posted.length = 0
    const request = controller.requestFiles(["one.ts", "two.ts"])
    await ready
    controller.stop()
    release()
    await request

    const messages = byType(posted, "diffViewer.diffFile")
    expect(messages.map((message) => message.file)).toEqual(["one.ts", "two.ts"])
    expect(messages.every((message) => message.diff === null)).toBe(true)
  })
})

describe("SourceController.reactivate", () => {
  it("rebuilds the active source via the build factory and refetches", async () => {
    let builds = 0
    let fetches = 0
    const dirs: Array<string | undefined> = []
    const factory = (): DiffSource => {
      builds++
      return {
        descriptor: WORKSPACE_DESC,
        async fetch() {
          fetches++
          return { diffs: [], stopPolling: true }
        },
      }
    }
    const posted: unknown[] = []
    const controller = new SourceController(
      (_id, ctx) => {
        dirs.push(ctx.dir)
        return factory()
      },
      () => [WORKSPACE_DESC],
      (m) => posted.push(m),
    )
    controller.setContext({ workspaceRoot: "/repo" })
    await controller.activate("workspace")
    expect(builds).toBe(1)
    expect(fetches).toBe(1)

    controller.setContext({ workspaceRoot: "/repo", dir: "/repo/app_beta" })
    await controller.reactivate()
    expect(builds).toBe(2)
    expect(fetches).toBe(2)
    expect(dirs).toEqual([undefined, "/repo/app_beta"])

    controller.stop()
  })

  it("is a no-op when nothing is active", async () => {
    const posted: unknown[] = []
    const controller = new SourceController(
      () => {
        throw new Error("should not build")
      },
      () => [],
      (m) => posted.push(m),
    )
    await controller.reactivate()
    expect(posted).toEqual([])
  })
})

describe("SourceController.refresh", () => {
  it("runs a one-shot active source fetch without restarting polling", async () => {
    let fetches = 0
    const source: DiffSource = {
      descriptor: SESSION_DESC,
      async fetch() {
        fetches++
        return { diffs: [{ file: `file-${fetches}.ts` } as never] }
      },
    }
    const { controller, posted } = make({ "session:s1": source })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("session:s1", { poll: false })
    posted.length = 0

    await controller.refresh()

    expect(fetches).toBe(2)
    const diffs = byType(posted, "diffViewer.diffs")
    expect(diffs).toHaveLength(1)
    expect(diffs[0]!.diffs).toEqual([{ file: "file-2.ts" }])
    expect(byType(posted, "diffViewer.loading").map((m) => m.loading)).toEqual([true, false])

    controller.stop()
  })

  it("runs a forced refresh after an in-flight fetch", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let fetches = 0
    const source: DiffSource = {
      descriptor: SESSION_DESC,
      async fetch() {
        fetches++
        await gate
        return { diffs: [] }
      },
    }
    const { controller } = make({ "session:s1": source })
    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    const activation = controller.activate("session:s1", { poll: false })
    const refresh = controller.refresh()
    release()
    await Promise.all([activation, refresh])

    expect(fetches).toBe(2)
    controller.stop()
  })
})
