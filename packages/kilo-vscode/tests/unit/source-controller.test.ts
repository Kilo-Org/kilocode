import { describe, it, expect } from "bun:test"
import * as vscode from "vscode"
import type { KiloConnectionService } from "../../src/services/cli-backend"
import { DiffSourceCatalog } from "../../src/diff/sources/catalog"
import { SourceController } from "../../src/diff/SourceController"
import type { DiffSource, DiffSourceDescriptor, DiffSourceMessage, DiffSourcePost } from "../../src/diff/sources/types"
import type { PanelContext } from "../../src/diff/types"

// ------ fakes ------

class RecordedSource implements DiffSource {
  initialFetchCount = 0
  startCount = 0
  startDisposed = false
  disposeCount = 0
  revertCalls: string[] = []
  revertFile: ((file: string) => Promise<{ ok: boolean; message: string }>) | undefined
  private release: (() => void) | undefined

  constructor(
    readonly descriptor: DiffSourceDescriptor,
    private readonly initial: DiffSourceMessage[] = [],
    private readonly deferred = false,
    revertImpl?: (file: string) => Promise<{ ok: boolean; message: string }>,
  ) {
    if (revertImpl) {
      this.revertFile = async (file: string) => {
        this.revertCalls.push(file)
        return revertImpl(file)
      }
    }
  }

  async initialFetch(post: DiffSourcePost): Promise<void> {
    this.initialFetchCount++
    if (this.deferred) await new Promise<void>((resolve) => (this.release = resolve))
    for (const msg of this.initial) post(msg)
  }

  resolve(): void {
    this.release?.()
  }

  start(_post: DiffSourcePost): vscode.Disposable {
    this.startCount++
    return new vscode.Disposable(() => {
      this.startDisposed = true
    })
  }

  dispose(): void {
    this.disposeCount++
  }
}

class FakeCatalog extends DiffSourceCatalog {
  private readonly sources = new Map<string, RecordedSource>()
  buildCalls: Array<{ id: string; ctx: PanelContext }> = []

  constructor(private readonly descriptors: DiffSourceDescriptor[]) {
    super({} as KiloConnectionService)
  }

  setSource(id: string, src: RecordedSource): void {
    this.sources.set(id, src)
  }

  override listAvailable(_ctx: PanelContext): DiffSourceDescriptor[] {
    return this.descriptors
  }

  override defaultSourceId(ctx: PanelContext): string | undefined {
    if (ctx.initialSourceId) return ctx.initialSourceId
    if (ctx.sessionId) return `session:${ctx.sessionId}`
    return this.descriptors[0]?.id
  }

  override build(id: string, ctx: PanelContext): DiffSource {
    this.buildCalls.push({ id, ctx })
    const src = this.sources.get(id)
    if (!src) throw new Error(`FakeCatalog: no source registered for id "${id}"`)
    return src
  }
}

// ------ harness ------

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

function harness(descriptors: DiffSourceDescriptor[], sources: Record<string, RecordedSource>) {
  const catalog = new FakeCatalog(descriptors)
  for (const [id, src] of Object.entries(sources)) catalog.setSource(id, src)

  const posted: unknown[] = []
  const controller = new SourceController(catalog, (msg) => posted.push(msg))
  return { controller, catalog, posted }
}

const byType = (posted: unknown[], type: string) =>
  posted.filter((m): m is Record<string, unknown> => {
    return typeof m === "object" && m !== null && (m as { type: string }).type === type
  })

// ------ tests ------

describe("SourceController.activate", () => {
  it("builds, fetches, and starts the source", async () => {
    const session = new RecordedSource(SESSION_DESC, [{ type: "diffs", diffs: [] }])
    const { controller, posted } = harness([WORKSPACE_DESC, SESSION_DESC], { "session:s1": session })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("session:s1")

    expect(session.initialFetchCount).toBe(1)
    expect(session.startCount).toBe(1)
    expect(controller.currentId).toBe("session:s1")

    const available = byType(posted, "setAvailableSources")
    expect(available).toHaveLength(1)
    expect(available[0]!.currentId).toBe("session:s1")
    expect(available[0]!.descriptors).toEqual([WORKSPACE_DESC, SESSION_DESC])

    const caps = byType(posted, "diffViewer.capabilities")
    expect(caps).toHaveLength(1)
    expect(caps[0]!.capabilities).toEqual({ revert: false, comments: true })
  })

  it("is a no-op when no context is set", async () => {
    const session = new RecordedSource(SESSION_DESC)
    const { controller, posted } = harness([SESSION_DESC], { "session:s1": session })

    await controller.activate("session:s1")

    expect(session.initialFetchCount).toBe(0)
    expect(controller.currentId).toBeUndefined()
    expect(posted).toEqual([])
  })

  it("disposes the previous source when activating a new one", async () => {
    const workspace = new RecordedSource(WORKSPACE_DESC, [{ type: "diffs", diffs: [] }])
    const session = new RecordedSource(SESSION_DESC, [{ type: "diffs", diffs: [] }])
    const { controller } = harness([WORKSPACE_DESC, SESSION_DESC], { workspace, "session:s1": session })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("workspace")
    await controller.activate("session:s1")

    expect(workspace.disposeCount).toBe(1)
    expect(workspace.startDisposed).toBe(true)
    expect(session.initialFetchCount).toBe(1)
    expect(session.startCount).toBe(1)
    expect(controller.currentId).toBe("session:s1")
  })

  it("does not start polling if the controller is stopped during initialFetch", async () => {
    const session = new RecordedSource(SESSION_DESC, [], true)
    const { controller } = harness([SESSION_DESC], { "session:s1": session })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    const activation = controller.activate("session:s1")
    // initialFetch is pending; simulate external dispose.
    controller.stop()
    session.resolve()
    await activation

    expect(session.initialFetchCount).toBe(1)
    expect(session.startCount).toBe(0)
    expect(session.disposeCount).toBe(1)
  })

  it("drops stale posts from a source that was swapped out", async () => {
    // Capture the post given to the workspace source so we can simulate
    // a late message after the swap.
    let capturedPost: DiffSourcePost | undefined
    const workspace: DiffSource = {
      descriptor: WORKSPACE_DESC,
      async initialFetch(post) {
        capturedPost = post
      },
      start() {
        return new vscode.Disposable(() => {})
      },
      dispose() {},
    }
    const session = new RecordedSource(SESSION_DESC, [{ type: "diffs", diffs: [] }])
    const catalog = new FakeCatalog([WORKSPACE_DESC, SESSION_DESC])
    catalog.setSource("session:s1", session)
    // Inject workspace through a direct override since it's not a RecordedSource.
    const originalBuild = catalog.build.bind(catalog)
    catalog.build = (id, ctx) => (id === "workspace" ? workspace : originalBuild(id, ctx))

    const posted: unknown[] = []
    const controller = new SourceController(catalog, (msg) => posted.push(msg))

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("workspace")
    await controller.activate("session:s1")

    posted.length = 0
    capturedPost?.({ type: "diffs", diffs: [{ file: "stale.ts" } as never] })

    expect(byType(posted, "diffViewer.diffs")).toEqual([])
  })

  it("propagates a build failure so callers can log it", async () => {
    const catalog = new FakeCatalog([WORKSPACE_DESC])
    // No sources registered → build throws.
    const posted: unknown[] = []
    const controller = new SourceController(catalog, (msg) => posted.push(msg))

    controller.setContext({ workspaceRoot: "/repo" })
    await expect(controller.activate("workspace")).rejects.toThrow(/no source registered/)
  })
})

describe("SourceController.stop / dispose", () => {
  it("stop disposes the active source and its start subscription", async () => {
    const session = new RecordedSource(SESSION_DESC)
    const { controller } = harness([SESSION_DESC], { "session:s1": session })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("session:s1")

    controller.stop()
    expect(session.disposeCount).toBe(1)
    expect(session.startDisposed).toBe(true)
    expect(controller.currentId).toBeUndefined()
  })

  it("dispose delegates to stop", async () => {
    const session = new RecordedSource(SESSION_DESC)
    const { controller } = harness([SESSION_DESC], { "session:s1": session })

    controller.setContext({ workspaceRoot: "/repo", sessionId: "s1" })
    await controller.activate("session:s1")
    controller.dispose()

    expect(session.disposeCount).toBe(1)
    expect(controller.currentId).toBeUndefined()
  })
})

describe("SourceController.revertFile", () => {
  it("posts error when the active source does not support revert", async () => {
    const session = new RecordedSource(SESSION_DESC)
    const { controller, posted } = harness([SESSION_DESC], { "session:s1": session })

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
    const workspace = new RecordedSource(WORKSPACE_DESC, [], false, async () => ({ ok: true, message: "Reverted" }))
    const { controller, posted } = harness([WORKSPACE_DESC], { workspace })

    controller.setContext({ workspaceRoot: "/repo" })
    await controller.activate("workspace")
    posted.length = 0
    await controller.revertFile("foo.ts")

    expect(workspace.revertCalls).toEqual(["foo.ts"])
    const results = byType(posted, "diffViewer.revertFileResult")
    expect(results[0]!.status).toBe("success")
    expect(results[0]!.message).toBe("Reverted")
  })

  it("posts error when the revert implementation throws", async () => {
    const workspace = new RecordedSource(WORKSPACE_DESC, [], false, async () => {
      throw new Error("boom")
    })
    const { controller, posted } = harness([WORKSPACE_DESC], { workspace })

    controller.setContext({ workspaceRoot: "/repo" })
    await controller.activate("workspace")
    posted.length = 0
    await controller.revertFile("foo.ts")

    const results = byType(posted, "diffViewer.revertFileResult")
    expect(results[0]!.status).toBe("error")
    expect(results[0]!.message).toBe("boom")
  })
})
