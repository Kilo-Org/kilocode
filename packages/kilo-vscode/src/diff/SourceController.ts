import type * as vscode from "vscode"
import type { DiffSource, DiffSourceDescriptor, DiffSourceMessage, DiffSourcePost } from "./sources/types"
import type { PanelContext } from "./types"

/**
 * Owns the active DiffSource for a panel: builds it via the injected
 * `build` function, runs initialFetch + start, and disposes it on swap
 * or teardown.
 *
 * Decoupled from the webview panel — receives neutral callbacks. Stale
 * messages are filtered via an internal epoch counter that bumps on
 * every stop/activate, so async posts from a disposed source are dropped.
 */
export class SourceController {
  private ctx: PanelContext | undefined
  private activeId: string | undefined
  private active: DiffSource | undefined
  private startDisposable: vscode.Disposable | undefined
  private epoch = 0

  constructor(
    private readonly build: (id: string, ctx: PanelContext) => DiffSource,
    private readonly listAvailable: (ctx: PanelContext) => DiffSourceDescriptor[],
    private readonly post: (msg: unknown) => void,
  ) {}

  setContext(ctx: PanelContext): void {
    this.ctx = ctx
  }

  get currentId(): string | undefined {
    return this.activeId
  }

  /** Dispose the active source and bump the epoch so in-flight posts are dropped. */
  stop(): void {
    this.epoch++
    this.startDisposable?.dispose()
    this.startDisposable = undefined
    this.active?.dispose()
    this.active = undefined
    this.activeId = undefined
  }

  /**
   * Build, initial-fetch, and start source `id` in the current context.
   * Internally disposes any previously active source. Throws if the
   * catalog can't build the id — callers should catch and log.
   */
  async activate(id: string): Promise<void> {
    const ctx = this.ctx
    if (!ctx) return
    this.stop()
    const epoch = this.epoch
    this.activeId = id

    const source = this.build(id, ctx)
    this.active = source

    this.post({
      type: "setAvailableSources",
      descriptors: this.listAvailable(ctx),
      currentId: id,
    })
    this.post({
      type: "diffViewer.capabilities",
      capabilities: source.descriptor.capabilities,
    })

    const sourcePost = this.guardedPost(epoch)
    await source.initialFetch(sourcePost)
    // Prevents source polling from starting after teardown or source swap.
    if (this.epoch !== epoch || this.activeId !== id) {
      if (this.active === source) source.dispose()
      return
    }
    this.startDisposable = source.start?.(sourcePost)
  }

  async revertFile(file: string): Promise<void> {
    const source = this.active
    if (!source?.revertFile) {
      this.post({
        type: "diffViewer.revertFileResult",
        file,
        status: "error",
        message: "Revert is not supported for the current source",
      })
      return
    }

    const result = await source.revertFile(file).catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, message }
    })
    this.post({
      type: "diffViewer.revertFileResult",
      file,
      status: result.ok ? "success" : "error",
      message: result.message,
    })
  }

  /**
   * Lazy detail load for a single file. Forwards to the active source's
   * `requestFile`. Posts `diff: null` when the source can't resolve the file
   * or doesn't support per-file detail, so the webview can clear its
   * pending-loading indicator either way.
   */
  async requestFile(file: string): Promise<void> {
    const source = this.active
    const epoch = this.epoch
    if (!source?.requestFile) {
      this.post({ type: "diffViewer.diffFile", file, diff: null })
      return
    }
    const diff = await source.requestFile(file).catch(() => null)
    // Drop the response if the source has been disposed/swapped while we waited.
    if (this.epoch !== epoch) return
    this.post({ type: "diffViewer.diffFile", file, diff })
  }

  dispose(): void {
    this.stop()
  }

  private guardedPost(epoch: number): DiffSourcePost {
    return (msg: DiffSourceMessage) => {
      // Drops stale messages from sources whose lifecycle epoch has ended.
      if (this.epoch !== epoch) return
      if (msg.type === "diffs") {
        this.post({ type: "diffViewer.diffs", diffs: msg.diffs })
      } else if (msg.type === "loading") {
        this.post({ type: "diffViewer.loading", loading: msg.loading })
      } else if (msg.type === "error") {
        this.post({ type: "diffViewer.loading", loading: false })
      } else if (msg.type === "notice") {
        this.post({ type: "diffViewer.notice", notice: msg.notice })
      }
    }
  }
}
