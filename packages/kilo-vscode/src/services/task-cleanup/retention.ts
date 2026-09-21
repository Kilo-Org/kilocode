import * as vscode from "vscode"
import type { KiloConnectionService } from "../cli-backend"

export interface RetentionResult {
  at: number
  scanned: number
  deleted: number
  skippedActive: number
  failed: number
  durationMs: number
}

export interface RetentionStatus {
  policy: { enabled: boolean; maxAgeDays: number }
  last: RetentionResult | null
  progress?: {
    phase: "scanning" | "deleting"
    total: number
    processed: number
    deleted: number
    failed: number
    skippedActive: number
  }
}

const DAY_MS = 86_400_000
/**
 * First attempt goes out shortly after start so a pass isn't a full day away
 * for users who don't keep a window open. The backend spacing guard makes
 * these early pings harmless.
 */
const FIRST_TICK_MS = 2 * 60_000
const STATE_KEY = "taskCleanup.lastResult"

/**
 * Thin client over the backend-owned session retention endpoints. The backend
 * decides everything — enablement, spacing between passes, which sessions are
 * expired, and which are busy — so this service only triggers a pass once a
 * day and surfaces the current state.
 */
export class RetentionService {
  private timer?: ReturnType<typeof setTimeout>
  private disposed = false
  private pending = 0

  get running(): boolean {
    return this.pending > 0
  }

  constructor(
    private readonly connection: KiloConnectionService,
    private readonly context: vscode.ExtensionContext,
  ) {}

  start(): void {
    this.disposed = false
    this.schedule(FIRST_TICK_MS)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => void this.tick(), delay)
  }

  /** Cached last-run summary, used when the backend cannot be reached. */
  lastResult(): RetentionResult | null {
    return this.context.globalState.get<RetentionResult>(STATE_KEY) ?? null
  }

  private async tick(): Promise<void> {
    if (this.disposed) return
    try {
      await this.run(false)
    } catch (err) {
      console.warn("[Kilo New] Scheduled retention pass failed:", err)
    } finally {
      if (!this.disposed) this.schedule(DAY_MS)
    }
  }

  private directory(): string | undefined {
    return vscode.workspace.workspaceFolders?.at(0)?.uri.fsPath
  }

  private cache(result: RetentionResult): void {
    void this.context.globalState.update(STATE_KEY, result)
  }

  /**
   * Runs one backend retention pass. Throws when the backend is not
   * connected; the backend itself refuses to run when the policy is disabled.
   */
  async run(force: boolean): Promise<RetentionStatus | null> {
    this.pending++
    try {
      const client = this.connection.getClient()
      const directory = this.directory()
      const response = await client.kilocode.retention.run(
        { ...(directory ? { directory } : {}), force },
        { throwOnError: true },
      )
      return this.normalize(response.data)
    } finally {
      this.pending--
    }
  }

  async status(): Promise<RetentionStatus | null> {
    const client = this.connection.getClient()
    const directory = this.directory()
    const signal = AbortSignal.timeout(10_000)
    const response = await client.kilocode.retention
      .status(directory ? { directory } : {}, {
        throwOnError: true,
        signal,
      })
      .catch((error: unknown) => {
        // Some fetch implementations replace the timeout reason with AbortError.
        throw signal.aborted ? signal.reason : error
      })
    return this.normalize(response.data)
  }

  /** The SDK types JSON numbers as a NaN/Infinity union; the wire format is a plain number. */
  private normalize(data: unknown): RetentionStatus {
    const status = data as RetentionStatus
    if (status.last) this.cache(status.last)
    return status
  }
}

let shared: RetentionService | undefined

/** One trigger per extension host, shared by every KiloProvider instance. */
export function retention(connection: KiloConnectionService, context: vscode.ExtensionContext): RetentionService {
  return (shared ??= new RetentionService(connection, context))
}
