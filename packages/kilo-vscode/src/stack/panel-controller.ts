import type { StackApplyFailure, StackDraft, StackExtensionMessage, StackLoadData, StackWebviewMessage } from "./types"
import { StackClientError, type StackClient } from "./client"

export type StackOperation = "load" | "preview" | "apply"

type Post = (message: StackExtensionMessage) => void

type Token = { generation: number; request: number }

type Refresh =
  | { ok: true; data: StackLoadData }
  | {
      ok: false
      error: unknown
    }

function message(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function stale(err: unknown): boolean {
  if (err instanceof StackClientError && err.status === 409) return true
  return err instanceof StackClientError && err.code === "stale_plan"
}

function failure(err: unknown): StackApplyFailure | undefined {
  if (!(err instanceof StackClientError)) return
  const detail = err.detail
  if (!detail || !("code" in detail) || detail.code !== "apply_failed") return
  return detail
}

export class StackPanelController {
  private generation = 0
  private request = 0
  private disposed = false
  private applying: Promise<boolean> | undefined
  private transitioning: Promise<void> | undefined

  constructor(
    private readonly client: StackClient,
    private readonly post: Post,
    private readonly close: () => void,
    private project: string | null,
  ) {}

  setProject(project: string | null): Promise<void> {
    const prior = this.transitioning
    const task = (async () => {
      if (prior) await prior
      const applying = this.applying
      if (applying) await applying
      if (this.disposed || project === this.project) return
      this.project = project
      this.invalidate()
    })()
    this.transitioning = task
    void task.then(() => {
      if (this.transitioning === task) this.transitioning = undefined
    })
    return task
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.invalidate()
  }

  async load(): Promise<void> {
    const project = this.project
    const applying = this.applying
    if (applying) {
      const refreshed = await applying
      const transitioning = this.transitioning
      if (transitioning) await transitioning
      if (this.disposed) return
      if (project === this.project && refreshed) return
    }
    const transitioning = this.transitioning
    if (transitioning) await transitioning
    await this.read()
  }

  async handle(event: StackWebviewMessage): Promise<void> {
    if (this.disposed) return
    switch (event.type) {
      case "stackLoad":
        await this.load()
        return
      case "stackPreview":
        await this.preview(event.draft)
        return
      case "stackApply":
        await this.apply(event.draft, event.planHash)
        return
      case "stackCancel":
        this.close()
        return
      case "stackRestoreProject":
        return
    }
  }

  private async read(): Promise<void> {
    const project = this.project
    if (!project) {
      if (!this.disposed) this.post({ type: "stackProjectRequired" })
      return
    }
    const token = this.start()
    const outcome = await this.client.load(project).then(
      (data) => ({ ok: true, data }) as const,
      (error: unknown) => ({ ok: false, error }) as const,
    )
    if (!this.active(token)) return
    if (!outcome.ok) {
      this.fail("load", outcome.error)
      return
    }
    this.post({ type: "stackLoadResult", data: outcome.data })
  }

  private async preview(draft: StackDraft): Promise<void> {
    const applying = this.applying
    if (applying) {
      await applying
      return
    }
    const transitioning = this.transitioning
    if (transitioning) await transitioning
    const project = this.project
    if (!project) {
      this.post({ type: "stackProjectRequired" })
      return
    }
    const token = this.start()
    const outcome = await this.client.preview(project, draft).then(
      (plan) => ({ ok: true, plan }) as const,
      (error: unknown) => ({ ok: false, error }) as const,
    )
    if (!this.active(token)) return
    if (!outcome.ok) {
      this.fail("preview", outcome.error)
      return
    }
    this.post({ type: "stackPreviewResult", plan: outcome.plan })
  }

  private async apply(draft: StackDraft, planHash: string): Promise<void> {
    const current = this.applying
    if (current) {
      await current
      return
    }
    const transitioning = this.transitioning
    if (transitioning) await transitioning
    if (this.applying) {
      await this.applying
      return
    }
    const project = this.project
    if (!project) {
      this.post({ type: "stackProjectRequired" })
      return
    }
    const task = this.mutate(project, draft, planHash)
    this.applying = task
    await task
    if (this.applying === task) this.applying = undefined
  }

  private async mutate(project: string, draft: StackDraft, planHash: string): Promise<boolean> {
    const token = this.start()
    const outcome = await this.client.apply(project, draft, planHash).then(
      (result) => ({ ok: true, result }) as const,
      (error: unknown) => ({ ok: false, error }) as const,
    )
    const refresh: Refresh = await this.client.load(project).then(
      (data) => ({ ok: true, data }) as const,
      (error: unknown) => ({ ok: false, error }) as const,
    )
    if (!this.active(token)) return refresh.ok
    if (outcome.ok) {
      this.post({
        type: "stackApplyResult",
        result: outcome.result,
        ...(refresh.ok ? { data: refresh.data } : { refreshError: message(refresh.error) }),
      })
      return refresh.ok
    }
    const detail = failure(outcome.error)
    if (detail) {
      this.post({
        type: "stackApplyFailure",
        failure: detail,
        ...(refresh.ok ? { data: refresh.data } : { refreshError: message(refresh.error) }),
      })
      return refresh.ok
    }
    this.fail("apply", outcome.error, {
      ...(refresh.ok ? { data: refresh.data } : { refreshError: message(refresh.error) }),
    })
    return refresh.ok
  }

  private invalidate(): void {
    this.generation++
    this.request++
  }

  private start(): Token {
    return { generation: this.generation, request: ++this.request }
  }

  private active(token: Token): boolean {
    return !this.disposed && token.generation === this.generation && token.request === this.request
  }

  private fail(
    operation: StackOperation,
    err: unknown,
    refresh: { data?: StackLoadData; refreshError?: string } = {},
  ): void {
    this.post({
      type: "stackError",
      operation,
      message: message(err),
      ...(err instanceof StackClientError && err.code ? { code: err.code } : {}),
      ...(stale(err) ? { stale: true } : {}),
      ...refresh,
    })
  }
}
