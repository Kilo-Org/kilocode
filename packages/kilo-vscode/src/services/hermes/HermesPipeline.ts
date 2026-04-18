import * as vscode from "vscode"
import type { HermesClient } from "./HermesClient"
import type { HermesStatusService } from "./HermesStatusService"
import type { ApprovalMode, TaskEnvelope, TaskEvent, TaskState, TaskStatus } from "./types"

export interface SubmitOpts {
  /** Free-form description of what the user wants. */
  intent: string
  /** Whether this task will need ZeroClaw to actually run commands. */
  requiresExecution: boolean
  /** Override the VS Code setting for this single task (null = use setting). */
  approvalMode?: ApprovalMode
  /** Extra workspace paths the task is allowed to touch. */
  extraScope?: string[]
  allowNetwork?: boolean
  allowWrite?: boolean
}

export interface SubmitHandle {
  taskId: string
  initial: TaskState
  unsubscribe: () => void
}

/**
 * The pipeline orchestrator on the KiloCode side.
 *
 * Responsibilities:
 *  - Build a valid TaskEnvelope from an opts + current VS Code workspace
 *  - POST it to the Hermes Bridge API
 *  - Subscribe to SSE state changes and forward them into VS Code UI
 *  - Handle approval prompts when Hermes emits "awaiting_approval"
 *
 * NON-responsibilities (enforced by design rules):
 *  - Never build ZeroClaw jobs directly (that's Hermes's job)
 *  - Never write memory (Hermes owns Shiba)
 *  - Never choose a provider (Hermes owns routing)
 */
export class HermesPipeline implements vscode.Disposable {
  private readonly subs = new Map<string, () => void>()

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly status: HermesStatusService,
    private readonly client: HermesClient,
  ) {}

  /** Submit a task. Returns a handle for cancellation / approval. */
  async submit(opts: SubmitOpts): Promise<SubmitHandle | undefined> {
    const cfg = this.status.getConfig()
    if (!cfg.enabled) {
      console.log("[Kilo Hermes] submit() called while disabled — no-op")
      return undefined
    }

    const project = this.resolveProject()
    if (!project) {
      void vscode.window.showWarningMessage(
        "Hermes pipeline: no workspace folder open. Skipped task submission.",
      )
      return undefined
    }

    const env = buildEnvelope(opts, project, cfg.approvalMode, cfg.workspaceScopeOnly)
    const created = await this.client.postTask(env).catch((err: unknown) => {
      console.error("[Kilo Hermes] postTask failed:", err)
      void vscode.window.showErrorMessage(
        `Hermes pipeline: failed to submit task — ${describe(err)}`,
      )
      return undefined
    })
    if (!created) return undefined

    const unsub = this.client.subscribe(created.task_id, (e) => {
      void this.onEvent(created.task_id, e)
    })
    this.subs.set(created.task_id, unsub)
    return { taskId: created.task_id, initial: created.state, unsubscribe: unsub }
  }

  /** Cancel a task (best effort). */
  async cancel(taskId: string): Promise<void> {
    const unsub = this.subs.get(taskId)
    if (unsub) unsub()
    this.subs.delete(taskId)
    await this.client.cancel(taskId).catch((err: unknown) => {
      console.warn("[Kilo Hermes] cancel failed:", err)
    })
  }

  dispose(): void {
    for (const unsub of this.subs.values()) unsub()
    this.subs.clear()
  }

  // -- internal ---------------------------------------------------------------

  private resolveProject(): string | undefined {
    const folders = vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) return undefined
    return folders[0].uri.fsPath
  }

  private async onEvent(taskId: string, e: TaskEvent): Promise<void> {
    if (e.state === "awaiting_approval") {
      await this.promptApproval(taskId, e)
      return
    }
    if (e.state === "completed" || e.state === "failed" || e.state === "rolled_back") {
      const status = await this.client.getTask(taskId).catch(() => undefined)
      this.showFinal(taskId, e.state, status)
      const unsub = this.subs.get(taskId)
      if (unsub) unsub()
      this.subs.delete(taskId)
    }
  }

  private async promptApproval(taskId: string, e: TaskEvent): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      `Hermes task ${taskId} awaiting approval${e.detail ? `: ${e.detail}` : ""}`,
      { modal: true },
      "Approve",
      "Cancel Task",
    )
    if (choice === "Approve") {
      await this.client.approve(taskId).catch((err: unknown) => {
        void vscode.window.showErrorMessage(`Hermes approve failed: ${describe(err)}`)
      })
      return
    }
    if (choice === "Cancel Task") {
      await this.cancel(taskId)
    }
  }

  private showFinal(taskId: string, state: TaskState, status: TaskStatus | undefined): void {
    if (state === "completed") {
      void vscode.window.showInformationMessage(
        `Hermes task ${taskId} ✓ ${status?.summary ?? "completed"}`,
      )
      return
    }
    if (state === "failed") {
      const msg = status?.error?.message ?? status?.summary ?? "failed"
      void vscode.window.showErrorMessage(`Hermes task ${taskId} ✗ ${msg}`)
      return
    }
    void vscode.window.showWarningMessage(`Hermes task ${taskId} rolled back.`)
  }
}

/** Envelope builder — pure function, easy to unit-test. */
export function buildEnvelope(
  opts: SubmitOpts,
  project: string,
  configMode: ApprovalMode,
  workspaceScopeOnly: boolean,
): TaskEnvelope {
  const scope = workspaceScopeOnly ? [project, ...(opts.extraScope ?? [])] : opts.extraScope ?? [project]
  const kiloVersion = process.env.KILO_VERSION ?? process.env.npm_package_version
  return {
    task_id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    origin: "kilocode",
    user_intent: opts.intent,
    project_path: project,
    requires_execution: opts.requiresExecution,
    approval_mode: opts.approvalMode ?? configMode,
    constraints: {
      allow_network: opts.allowNetwork ?? false,
      allow_write: opts.allowWrite ?? true,
      workspace_scope: scope,
    },
    metadata: {
      submitter: "kilo-vscode",
      submitted_at: new Date().toISOString(),
      ...(kiloVersion ? { kilo_version: kiloVersion } : {}),
    },
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  return JSON.stringify(err)
}
