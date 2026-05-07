import { hashFileDiffs } from "./shared/hash"
import { DIFF_POLL_INTERVAL_MS } from "./polling"
import type { DiffSource, DiffSourceDescriptor } from "./sources/types"
import type { PanelContext } from "./types"

/**
 * Owns the active DiffSource for a panel: builds it via the injected `build`
 * function, runs an initial fetch, and then polls on a fixed interval with
 * hash-dedup. Posts loading / diffs / notice messages to the webview, and
 * disposes the source on swap or teardown.
 *
 * Sources are declarative — they only implement `fetch()` (and optionally
 * `fetchFile` / `revert` / `dispose`). All lifecycle, polling, and message
 * posting lives here so that concrete sources can be plain factory functions
 * with closure state instead of classes with a `post`/`start`/`dispose` dance.
 *
 * Stale results are filtered via an internal epoch counter that bumps on
 * every stop/activate, so in-flight fetches from a disposed source are
 * dropped.
 */
export class SourceController {
  private ctx: PanelContext | undefined
  private activeId: string | undefined
  private active: DiffSource | undefined
  private interval: ReturnType<typeof setInterval> | undefined
  private lastHash: string | undefined
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

  /** Dispose the active source and bump the epoch so in-flight fetches are dropped. */
  stop(): void {
    this.epoch++
    this.stopPolling()
    this.active?.dispose?.()
    this.active = undefined
    this.activeId = undefined
    this.lastHash = undefined
  }

  /**
   * Build, initial-fetch, and start polling source `id` in the current context.
   * Disposes any previously active source. Throws if the catalog can't build
   * the id — callers should catch and log.
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

    const keepPolling = await this.runFetch(source, epoch, true)
    // Prevents the polling interval from starting after teardown or swap.
    if (this.epoch !== epoch || this.activeId !== id) return
    if (keepPolling) this.startPolling(source, epoch)
  }

  async revertFile(file: string): Promise<void> {
    const source = this.active
    if (!source?.revert) {
      this.post({
        type: "diffViewer.revertFileResult",
        file,
        status: "error",
        message: "Revert is not supported for the current source",
      })
      return
    }

    const epoch = this.epoch
    const result = await source.revert(file).catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, message }
    })
    this.post({
      type: "diffViewer.revertFileResult",
      file,
      status: result.ok ? "success" : "error",
      message: result.message,
    })
    // Push fresh diffs immediately after a successful revert so the webview
    // doesn't have to wait for the next polling tick.
    if (result.ok && this.epoch === epoch && this.active === source) {
      await this.runFetch(source, epoch, false)
    }
  }

  /**
   * Lazy detail load for a single file. Forwards to the active source's
   * `fetchFile`. Posts `diff: null` when the source can't resolve the file
   * or doesn't support per-file detail, so the webview can clear its
   * pending-loading indicator either way.
   */
  async requestFile(file: string): Promise<void> {
    const source = this.active
    const epoch = this.epoch
    if (!source?.fetchFile) {
      this.post({ type: "diffViewer.diffFile", file, diff: null })
      return
    }
    const diff = await source.fetchFile(file).catch(() => null)
    // Drop the response if the source has been disposed/swapped while we waited.
    if (this.epoch !== epoch) return
    this.post({ type: "diffViewer.diffFile", file, diff })
  }

  dispose(): void {
    this.stop()
  }

  /**
   * Run one fetch against the source and post results. Returns whether the
   * controller should keep polling this source — false when the source
   * requests a stop or the epoch has moved on.
   */
  private async runFetch(source: DiffSource, epoch: number, initial: boolean): Promise<boolean> {
    if (initial) this.post({ type: "diffViewer.loading", loading: true })

    try {
      const result = await source.fetch()
      if (this.epoch !== epoch) return false

      if (result.notice !== undefined) {
        this.post({ type: "diffViewer.notice", notice: result.notice })
      }

      const hash = hashFileDiffs(result.diffs as never)
      if (initial || hash !== this.lastHash) {
        this.lastHash = hash
        this.post({ type: "diffViewer.diffs", diffs: result.diffs })
      }

      return !result.stopPolling
    } catch (err) {
      if (this.epoch !== epoch) return false
      // Errors are swallowed for the webview (it just needs the loading
      // indicator cleared below), but we always log so initial-fetch
      // failures leave a trace in the Extension Host output — previously
      // they were silent and invisible in production.
      console.log("[Kilo New] SourceController.fetch error", { initial, err })
      return true
    } finally {
      if (initial && this.epoch === epoch) {
        this.post({ type: "diffViewer.loading", loading: false })
      }
    }
  }

  private startPolling(source: DiffSource, epoch: number): void {
    this.stopPolling()
    this.interval = setInterval(async () => {
      // Self-cancel when the tick reports the source is done
      const keep = await this.runFetch(source, epoch, false)
      if (!keep) this.stopPolling()
    }, DIFF_POLL_INTERVAL_MS)
  }

  private stopPolling(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = undefined
    }
  }
}
