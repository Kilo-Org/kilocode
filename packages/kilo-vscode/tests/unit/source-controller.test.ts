import { describe, it, expect } from "bun:test"
import * as vscode from "vscode"
import { SourceController } from "../../src/diff/SourceController"
import type { DiffSource, DiffSourceDescriptor, DiffSourcePost } from "../../src/diff/sources/types"

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

function disposable(onDispose: () => void = () => {}): vscode.Disposable {
  return new vscode.Disposable(onDispose)
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
  it("builds, fetches, and starts the source", async () => {
    let starts = 0
    const source: DiffSource = {
      descriptor: SESSION_DESC,
      async initialFetch(post) {
        post({ type: "diffs", diffs: [] })
      },
      start() {
        starts++
        return disposable()
      },
      dispose() {},
    }
    const { controller, posted } = make({ "session:s1": source }, [WORKSPACE_DESC, SESSION_DESC])

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("session:s1")

    expect(starts).toBe(1)
    expect(controller.currentId).toBe("session:s1")

    const available = byType(posted, "setAvailableSources")
    expect(available).toHaveLength(1)
    expect(available[0]!.currentId).toBe("session:s1")
    expect(available[0]!.descriptors).toEqual([WORKSPACE_DESC, SESSION_DESC])

    const caps = byType(posted, "diffViewer.capabilities")
    expect(caps).toHaveLength(1)
    expect(caps[0]!.capabilities).toEqual({ revert: false, comments: true })
  })

  it("disposes the previous source when activating a new one", async () => {
    let workspaceDisposed = 0
    let workspaceSubscriptionDisposed = false
    const workspace: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async initialFetch() {},
      start() {
        return disposable(() => {
          workspaceSubscriptionDisposed = true
        })
      },
      dispose() {
        workspaceDisposed++
      },
    }
    let sessionStarts = 0
    const session: DiffSource = {
      descriptor: SESSION_DESC,
      async initialFetch() {},
      start() {
        sessionStarts++
        return disposable()
      },
      dispose() {},
    }
    const { controller } = make({ workspace, "session:s1": session })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("workspace")
    await controller.activate("session:s1")

    expect(workspaceDisposed).toBe(1)
    expect(workspaceSubscriptionDisposed).toBe(true)
    expect(sessionStarts).toBe(1)
    expect(controller.currentId).toBe("session:s1")
  })

  it("does not start polling if the controller is stopped during initialFetch", async () => {
    let release: () => void = () => {}
    let fetched = 0
    let started = 0
    let disposed = 0
    const session: DiffSource = {
      descriptor: SESSION_DESC,
      async initialFetch() {
        fetched++
        await new Promise<void>((r) => (release = r))
      },
      start() {
        started++
        return disposable()
      },
      dispose() {
        disposed++
      },
    }
    const { controller } = make({ "session:s1": session })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    const activation = controller.activate("session:s1")
    controller.stop()
    release()
    await activation

    expect(fetched).toBe(1)
    expect(started).toBe(0)
    expect(disposed).toBe(1)
  })

  it("drops stale posts from a source that was swapped out", async () => {
    let capturedPost: DiffSourcePost | undefined
    const workspace: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async initialFetch(post) {
        capturedPost = post
      },
      start() {
        return disposable()
      },
      dispose() {},
    }
    const session: DiffSource = {
      descriptor: SESSION_DESC,
      async initialFetch(post) {
        post({ type: "diffs", diffs: [] })
      },
      start() {
        return disposable()
      },
      dispose() {},
    }
    const { controller, posted } = make({ workspace, "session:s1": session })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("workspace")
    await controller.activate("session:s1")

    posted.length = 0
    capturedPost?.({ type: "diffs", diffs: [{ file: "stale.ts" } as never] })

    expect(byType(posted, "diffViewer.diffs")).toEqual([])
  })
})

describe("SourceController.stop", () => {
  it("disposes the active source and its start subscription", async () => {
    let disposed = 0
    let subscriptionDisposed = false
    const session: DiffSource = {
      descriptor: SESSION_DESC,
      async initialFetch() {},
      start() {
        return disposable(() => {
          subscriptionDisposed = true
        })
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
    expect(subscriptionDisposed).toBe(true)
    expect(controller.currentId).toBeUndefined()
  })
})

describe("SourceController.revertFile", () => {
  it("posts error when the active source does not support revert", async () => {
    const session: DiffSource = {
      descriptor: SESSION_DESC,
      async initialFetch() {},
      start() {
        return disposable()
      },
      dispose() {},
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
  })

  it("posts success from a successful revert", async () => {
    const calls: string[] = []
    const workspace: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async initialFetch() {},
      start() {
        return disposable()
      },
      async revertFile(file) {
        calls.push(file)
        return { ok: true, message: "Reverted" }
      },
      dispose() {},
    }
    const { controller, posted } = make({ workspace })

    controller.setContext({ workspaceRoot: "/repo" })
    await controller.activate("workspace")
    posted.length = 0
    await controller.revertFile("foo.ts")

    expect(calls).toEqual(["foo.ts"])
    const results = byType(posted, "diffViewer.revertFileResult")
    expect(results[0]!.status).toBe("success")
    expect(results[0]!.message).toBe("Reverted")
  })

  it("posts error when the revert implementation throws", async () => {
    const workspace: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async initialFetch() {},
      start() {
        return disposable()
      },
      async revertFile() {
        throw new Error("boom")
      },
      dispose() {},
    }
    const { controller, posted } = make({ workspace })

    controller.setContext({ workspaceRoot: "/repo" })
    await controller.activate("workspace")
    posted.length = 0
    await controller.revertFile("foo.ts")

    const results = byType(posted, "diffViewer.revertFileResult")
    expect(results[0]!.status).toBe("error")
    expect(results[0]!.message).toBe("boom")
  })
})
