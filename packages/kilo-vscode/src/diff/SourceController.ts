import { hashFileDiffs } from "./shared/hash"
import { DIFF_POLL_INTERVAL_MS } from "./polling"
import type { DiffSource, DiffSourceCapabilities, DiffSourceDescriptor, DiffSourceNotice } from "./sources/types"
import type { DiffFile } from "./types"
import type { PanelContext } from "./types"

type Messages = {
  available?: (descriptors: DiffSourceDescriptor[], id: string) => unknown
  capabilities?: (capabilities: DiffSourceCapabilities) => unknown
  loading?: (source: DiffSource, loading: boolean) => unknown
  diffs: (source: DiffSource, diffs: DiffFile[]) => unknown
  notice?: (source: DiffSource, notice: DiffSourceNotice | undefined) => unknown
  diffFile: (source: DiffSource | undefined, file: string, diff: DiffFile | null) => unknown
  revertFileResult: (source: DiffSource | undefined, file: string, result: { ok: boolean; message: string }) => unknown
  unsupportedRevert: (source: DiffSource | undefined, file: string) => unknown
}

type ActivateOptions = { poll?: boolean; fetch?: boolean }

const viewerMessages: Messages = {
  available: (descriptors, id) => ({
    type: "setAvailableSources",
    descriptors,
    currentId: id,
  }),
  capabilities: (capabilities) => ({
    type: "diffViewer.capabilities",
    capabilities,
  }),
  loading: (_source, loading) => ({ type: "diffViewer.loading", loading }),
  diffs: (_source, diffs) => ({ type: "diffViewer.diffs", diffs }),
  notice: (_source, notice) => ({ type: "diffViewer.notice", notice }),
  diffFile: (_source, file, diff) => ({ type: "diffViewer.diffFile", file, diff }),
  revertFileResult: (_source, file, result) => ({
    type: "diffViewer.revertFileResult",
    file,
    status: result.ok ? "success" : "error",
    message: result.message,
  }),
  unsupportedRevert: (_source, file) => ({
    type: "diffViewer.revertFileResult",
    file,
    status: "error",
    message: "Revert is not supported for the current source",
  }),
}

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
    private readonly messages: Messages = viewerMessages,
  ) {}

  setContext(ctx: PanelContext): void {
    this.ctx = ctx
  }

  get currentId(): string | undefined {
    return this.activeId
  }

  get isPolling(): boolean {
    return this.interval !== undefined
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
  async activate(id: string, opts: ActivateOptions = {}): Promise<void> {
    const ctx = this.ctx
    if (!ctx) return
    this.stop()
    const epoch = this.epoch
    this.activeId = id

    const source = this.build(id, ctx)
    this.active = source

    this.send(this.messages.available?.(this.listAvailable(ctx), id))
    this.send(this.messages.capabilities?.(source.descriptor.capabilities))

    if (opts.fetch === false) return

    const keepPolling = await this.runFetch(source, epoch, true)
    // Prevents the polling interval from starting after teardown or swap.
    if (this.epoch !== epoch || this.activeId !== id) return
    if (opts.poll !== false && keepPolling) this.startPolling(source, epoch)
  }

  /**
   * Rebuild the active source with current catalog state. Used when an
   * external setting changes (e.g. base branch override) and the source
   * needs to refetch with the new params, but the source id stays the same.
   * No-op when nothing is active.
   */
  async reactivate(): Promise<void> {
    const id = this.activeId
    if (!id) return
    await this.activate(id)
  }

  async revertFile(file: string): Promise<void> {
    const source = this.active
    if (!source?.revert) {
      this.send(this.messages.unsupportedRevert(source, file))
      return
    }

    const epoch = this.epoch
    const result = await source.revert(file).catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, message }
    })
    this.send(this.messages.revertFileResult(source, file, result))
    // Push fresh diffs immediately after a successful revert so the webview
    // doesn't have to wait for the next polling tick.
    if (result.ok && this.epoch === epoch && this.active === source) {
      await this.runFetch(source, epoch, false)
    }
  }

  /** Run an immediate fetch against the active source without changing polling state. */
  async refresh(): Promise<void> {
    const source = this.active
    if (!source) return
    const epoch = this.epoch
    await this.runFetch(source, epoch, true)
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
    if (!source) {
      this.send(this.messages.diffFile(undefined, file, null))
      return
    }
    if (!source.fetchFile) {
      this.send(this.messages.diffFile(source, file, null))
      return
    }
    const diff = await source.fetchFile(file).catch(() => null)
    // Drop the response if the source has been disposed/swapped while we waited.
    if (this.epoch !== epoch) return
    this.send(this.messages.diffFile(source, file, diff))
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
    if (initial) this.send(this.messages.loading?.(source, true))

    try {
      const result = await source.fetch()
      if (this.epoch !== epoch) return false

      if (result.notice !== undefined) {
        this.send(this.messages.notice?.(source, result.notice))
      }

      const hash = hashFileDiffs(result.diffs as never)
      if (initial || hash !== this.lastHash) {
        this.lastHash = hash
        this.send(this.messages.diffs(source, result.diffs))
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
        this.send(this.messages.loading?.(source, false))
      }
    }
  }

  private send(msg: unknown): void {
    if (msg === undefined) return
    this.post(msg)
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
