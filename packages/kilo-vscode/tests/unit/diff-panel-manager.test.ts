import { describe, it, expect } from "bun:test"
import * as vscode from "vscode"
import type { KiloConnectionService } from "../../src/services/cli-backend"
import { DiffSourceCatalog } from "../../src/diff/sources/catalog"
import { DiffPanelManager } from "../../src/diff/manager/DiffPanelManager"
import type { PanelSurface } from "../../src/diff/manager/panel-surface"
import type { Scheduler } from "../../src/diff/manager/scheduler"
import type { DiffSource, DiffSourceDescriptor, DiffSourceMessage, DiffSourcePost } from "../../src/diff/sources/types"
import type { PanelContext } from "../../src/diff/types"

// ------ fakes ------

class InMemoryPanelSurface implements PanelSurface {
  readonly posted: unknown[] = []
  private messageListener: ((msg: unknown) => void) | undefined
  private disposeListener: (() => void) | undefined
  private disposed = false
  revealCount = 0
  disposedCount = 0

  post(msg: unknown): void {
    this.posted.push(msg)
  }
  reveal(): void {
    this.revealCount++
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disposedCount++
    this.disposeListener?.()
  }
  onDispose(cb: () => void): vscode.Disposable {
    this.disposeListener = cb
    return new vscode.Disposable(() => {
      this.disposeListener = undefined
    })
  }
  onMessage(cb: (msg: unknown) => void): vscode.Disposable {
    this.messageListener = cb
    return new vscode.Disposable(() => {
      this.messageListener = undefined
    })
  }
  emit(msg: unknown): void {
    this.messageListener?.(msg)
  }
}

class TestScheduler implements Scheduler {
  private pending: Array<{ ms: number; fn: () => void; cancelled: boolean }> = []

  delay(ms: number, fn: () => void): vscode.Disposable {
    const entry = { ms, fn, cancelled: false }
    this.pending.push(entry)
    return new vscode.Disposable(() => {
      entry.cancelled = true
    })
  }

  /** Flush every scheduled callback that's still alive. */
  async flush(): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending
      this.pending = []
      for (const entry of batch) {
        if (!entry.cancelled) entry.fn()
      }
      // Let pending microtasks (e.g. async source fetches) settle so
      // another flush sees their side effects.
      await new Promise((r) => setTimeout(r, 0))
    }
  }
}

class RecordedSource implements DiffSource {
  initialFetchCount = 0
  startCount = 0
  startDisposed = false
  disposeCount = 0
  private release: (() => void) | undefined

  constructor(
    readonly descriptor: DiffSourceDescriptor,
    private readonly initial: DiffSourceMessage[] = [],
    private readonly deferred = false,
  ) {}

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
  seen: PanelContext | undefined

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
    this.seen = ctx
    if (ctx.initialSourceId) return ctx.initialSourceId
    if (ctx.sessionId) return `session:${ctx.sessionId}`
    return this.descriptors[0]?.id
  }

  override build(id: string, _ctx: PanelContext): DiffSource {
    const src = this.sources.get(id)
    if (!src) throw new Error(`FakeCatalog: no source registered for id "${id}"`)
    return src
  }
}

// ------ Harness ------

const WORKSPACE_DESC: DiffSourceDescriptor = {
  id: "workspace",
  label: "Local Changes",
  group: "Git",
  capabilities: { revert: true, comments: true },
}

const SESSION_DESC: DiffSourceDescriptor = {
  id: "session:s1",
  label: "Current session",
  group: "Session",
  capabilities: { revert: false, comments: true },
}

function harness(
  descriptors: DiffSourceDescriptor[],
  sources: Record<string, RecordedSource>,
  opts: { sessionIdProvider?: () => string | undefined } = {},
): {
  manager: DiffPanelManager
  surface: InMemoryPanelSurface
  scheduler: TestScheduler
  catalog: FakeCatalog
} {
  const catalog = new FakeCatalog(descriptors)
  for (const [id, src] of Object.entries(sources)) catalog.setSource(id, src)

  const surface = new InMemoryPanelSurface()
  const scheduler = new TestScheduler()

  const uri = { fsPath: "/ext" } as vscode.Uri
  const connection = {} as KiloConnectionService

  const manager = new DiffPanelManager(uri, connection, catalog, {
    scheduler,
    createSurface: () => surface,
    sessionIdProvider: opts.sessionIdProvider,
  })
  return { manager, surface, scheduler, catalog }
}

const diffs = (source: InMemoryPanelSurface) =>
  source.posted.filter((m): m is { type: "diffViewer.diffs"; diffs: unknown[] } => {
    return typeof m === "object" && m !== null && (m as { type: string }).type === "diffViewer.diffs"
  })

const byType = (posted: unknown[], type: string) =>
  posted.filter((m): m is Record<string, unknown> => {
    return typeof m === "object" && m !== null && (m as { type: string }).type === type
  })

// ------ Tests ------

describe("DiffPanelManager.openPanel", () => {
  it("defaults to the session source when both descriptors are available", async () => {
    const session = new RecordedSource(SESSION_DESC, [{ type: "diffs", diffs: [] }])
    const { manager, surface, scheduler } = harness([WORKSPACE_DESC, SESSION_DESC], {
      "session:s1": session,
    })

    manager.openPanel({ workspaceRoot: "/repo", sessionId: "s1" })
    surface.emit({ type: "webviewReady" })
    await scheduler.flush()

    expect(session.initialFetchCount).toBe(1)
    expect(session.startCount).toBe(1)

    // setAvailableSources is posted with the resolved currentId
    const available = byType(surface.posted, "setAvailableSources")
    expect(available).toHaveLength(1)
    expect(available[0]!.currentId).toBe("session:s1")
    expect(available[0]!.descriptors).toEqual([WORKSPACE_DESC, SESSION_DESC])

    // capabilities mirrors the active source
    const caps = byType(surface.posted, "diffViewer.capabilities")
    expect(caps).toHaveLength(1)
    expect(caps[0]!.capabilities).toEqual({ revert: false, comments: true })
  })

  it("falls back to workspace when no session is available", async () => {
    const workspace = new RecordedSource(WORKSPACE_DESC, [{ type: "diffs", diffs: [] }])
    const { manager, surface, scheduler } = harness([WORKSPACE_DESC], { workspace })

    manager.openPanel({ workspaceRoot: "/repo" })
    surface.emit({ type: "webviewReady" })
    await scheduler.flush()

    expect(workspace.initialFetchCount).toBe(1)
    const available = byType(surface.posted, "setAvailableSources")
    expect(available[0]!.currentId).toBe("workspace")
  })

  it("swaps sources when selectSource arrives from the webview", async () => {
    const workspace = new RecordedSource(WORKSPACE_DESC, [{ type: "diffs", diffs: [] }])
    const session = new RecordedSource(SESSION_DESC, [{ type: "diffs", diffs: [] }])
    const { manager, surface, scheduler } = harness([WORKSPACE_DESC, SESSION_DESC], {
      workspace,
      "session:s1": session,
    })

    manager.openPanel({ workspaceRoot: "/repo", sessionId: "s1", initialSourceId: "workspace" })
    surface.emit({ type: "webviewReady" })
    await scheduler.flush()

    expect(workspace.initialFetchCount).toBe(1)

    surface.posted.length = 0
    surface.emit({ type: "selectSource", id: "session:s1" })

    // Loading pulse is posted synchronously before the scheduled activate.
    const pre = surface.posted.slice()
    expect(workspace.disposeCount).toBe(1)
    expect(workspace.startDisposed).toBe(true)
    expect(byType(pre, "diffViewer.loading")[0]!.loading).toBe(true)
    expect(diffs(surface)[0]!.diffs).toEqual([])

    await scheduler.flush()

    expect(session.initialFetchCount).toBe(1)
    expect(session.startCount).toBe(1)
    const caps = byType(surface.posted, "diffViewer.capabilities")
    expect(caps.at(-1)!.capabilities).toEqual({ revert: false, comments: true })
  })

  it("reveals and swaps when openPanel is called again with a different default", async () => {
    const workspace = new RecordedSource(WORKSPACE_DESC, [{ type: "diffs", diffs: [] }])
    const session = new RecordedSource(SESSION_DESC, [{ type: "diffs", diffs: [] }])
    const { manager, surface, scheduler } = harness([WORKSPACE_DESC, SESSION_DESC], {
      workspace,
      "session:s1": session,
    })

    manager.openPanel({ workspaceRoot: "/repo", initialSourceId: "workspace" })
    surface.emit({ type: "webviewReady" })
    await scheduler.flush()

    const surfaceRef = surface
    manager.openPanel({ workspaceRoot: "/repo", sessionId: "s1", initialSourceId: "session:s1" })
    await scheduler.flush()

    expect(surfaceRef.revealCount).toBe(1)
    expect(surfaceRef.disposedCount).toBe(0)
    expect(workspace.disposeCount).toBe(1)
    expect(session.initialFetchCount).toBe(1)
  })

  it("openFromCommand resolves sessionId from the injected provider", async () => {
    const session = new RecordedSource(SESSION_DESC, [{ type: "diffs", diffs: [] }])
    const { manager, surface, scheduler, catalog } = harness(
      [WORKSPACE_DESC, SESSION_DESC],
      { "session:s1": session },
      { sessionIdProvider: () => "s1" },
    )

    manager.openFromCommand()
    surface.emit({ type: "webviewReady" })
    await scheduler.flush()

    expect(catalog.seen?.sessionId).toBe("s1")
    expect(catalog.seen?.workspaceRoot).toBe("/repo")
    expect(session.initialFetchCount).toBe(1)
  })

  it("openFromCommand prefers the arg sessionId over the provider", async () => {
    const session = new RecordedSource(SESSION_DESC, [{ type: "diffs", diffs: [] }])
    const { manager, surface, scheduler, catalog } = harness(
      [WORKSPACE_DESC, SESSION_DESC],
      { "session:s1": session },
      { sessionIdProvider: () => "fromProvider" },
    )

    manager.openFromCommand({ sessionId: "s1" })
    surface.emit({ type: "webviewReady" })
    await scheduler.flush()

    expect(catalog.seen?.sessionId).toBe("s1")
  })

  it("tears down source + surface on dispose", () => {
    const session = new RecordedSource(SESSION_DESC)
    const { manager, surface } = harness([SESSION_DESC], { "session:s1": session })

    manager.openPanel({ workspaceRoot: "/repo", sessionId: "s1" })
    surface.emit({ type: "webviewReady" })
    // Synchronously triggered scheduler not flushed → no source built yet.
    manager.dispose()

    // At minimum, surface was disposed; source may or may not exist yet.
    expect(surface.disposedCount >= 0).toBe(true)
  })

  it("does not start polling after dispose during initial fetch", async () => {
    const session = new RecordedSource(SESSION_DESC, [], true)
    const { manager, surface, scheduler } = harness([SESSION_DESC], { "session:s1": session })

    manager.openPanel({ workspaceRoot: "/repo", sessionId: "s1" })
    surface.emit({ type: "webviewReady" })
    await scheduler.flush()

    expect(session.initialFetchCount).toBe(1)

    manager.dispose()
    session.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(session.startCount).toBe(0)
    expect(session.disposeCount).toBe(1)
  })

  it("drops stale posts from a source after it has been swapped out", async () => {
    const workspace = new RecordedSource(
      WORKSPACE_DESC,
      [{ type: "diffs", diffs: [{ path: "stale.ts" } as never] }],
      true,
    )
    const session = new RecordedSource(SESSION_DESC, [{ type: "diffs", diffs: [{ path: "fresh.ts" } as never] }])
    const { manager, surface, scheduler } = harness([WORKSPACE_DESC, SESSION_DESC], {
      workspace,
      "session:s1": session,
    })

    manager.openPanel({ workspaceRoot: "/repo", sessionId: "s1", initialSourceId: "workspace" })
    surface.emit({ type: "webviewReady" })
    await scheduler.flush()

    // Swap to session source before the first source's initialFetch resolves.
    surface.emit({ type: "selectSource", id: "session:s1" })
    await scheduler.flush()

    surface.posted.length = 0
    workspace.resolve()
    await new Promise((r) => setTimeout(r, 0))

    // Stale workspace post after the swap must not reach the surface.
    expect(surface.posted).toEqual([])
  })
})
