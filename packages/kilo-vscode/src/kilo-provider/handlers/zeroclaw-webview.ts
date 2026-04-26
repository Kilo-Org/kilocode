/**
 * zeroclaw-webview.ts
 *
 * Bridges webview messages from ZeroClawTab.tsx → ZeroClawService.
 *
 * Message types handled:
 *   zeroClawGetHistory    → getAllTasks(), push zeroClawHistoryLoaded
 *   zeroClawSubmitTask    → service.submit(), push zeroClawTaskSubmitted
 *   zeroClawCancelTask    → service.cancel(), push zeroClawTaskUpdated
 *   zeroClawRetryTask     → service.retry(), push zeroClawTaskRetried
 *   zeroClawApproveTask   → service.approve(), push zeroClawTaskUpdated
 *   zeroClawRejectTask    → service.reject(), push zeroClawTaskUpdated
 */

import type { ZeroClawService, ZeroClawTask, TaskSubmission } from "../../services/zeroclaw/ZeroClawService"

export interface ZeroClawWebviewContext {
  service: ZeroClawService
  postMessage: (msg: unknown) => void
}

function pushTask(ctx: ZeroClawWebviewContext, task: ZeroClawTask): void {
  ctx.postMessage({ type: "zeroClawTaskUpdated", task })
}

// eslint-disable-next-line complexity
export function handleZeroClawWebviewMessage(
  msg: Record<string, unknown>,
  ctx: ZeroClawWebviewContext,
): boolean {
  switch (msg.type) {
    case "zeroClawGetHistory": {
      const tasks = ctx.service.getHistory(50)
      ctx.postMessage({ type: "zeroClawHistoryLoaded", tasks })
      return true
    }

    case "zeroClawSubmitTask": {
      try {
        const submission: TaskSubmission = {
          description: (msg.description as string) ?? "",
          projectPath: (msg.projectPath as string) ?? "",
          riskLevel: (msg.riskLevel as TaskSubmission["riskLevel"]) ?? "low",
          workspaceScope: (msg.workspaceScope as string) ?? "",
          networkPolicy: (msg.networkPolicy as TaskSubmission["networkPolicy"]) ?? "deny",
          writePolicy: (msg.writePolicy as TaskSubmission["writePolicy"]) ?? "read_only",
          limits: {
            timeoutSec: (msg.timeoutSec as number) ?? 300,
            memoryMb: (msg.memoryMb as number) ?? 512,
            cpu: (msg.cpu as number) ?? 1,
          },
        }
        const task = ctx.service.submit(submission)
        ctx.postMessage({ type: "zeroClawTaskSubmitted", task })
      } catch (e) {
        ctx.postMessage({ type: "zeroClawError", error: e instanceof Error ? e.message : String(e) })
      }
      return true
    }

    case "zeroClawCancelTask": {
      const taskId = msg.taskId as string
      ctx.service.cancel(taskId)
      const task = ctx.service.getTask(taskId)
      if (task) pushTask(ctx, task)
      return true
    }

    case "zeroClawRetryTask": {
      const taskId = msg.taskId as string
      const newTask = ctx.service.retry(taskId)
      if (newTask) {
        ctx.postMessage({ type: "zeroClawTaskRetried", newTask })
      } else {
        ctx.postMessage({ type: "zeroClawError", error: "Retry budget exhausted or task not found" })
      }
      return true
    }

    case "zeroClawApproveTask": {
      const taskId = msg.taskId as string
      const approver = (msg.approver as string) ?? "local-user"
      ctx.service.approve(taskId, approver)
      const task = ctx.service.getTask(taskId)
      if (task) pushTask(ctx, task)
      return true
    }

    case "zeroClawRejectTask": {
      const taskId = msg.taskId as string
      ctx.service.reject(taskId)
      const task = ctx.service.getTask(taskId)
      if (task) pushTask(ctx, task)
      return true
    }

    default:
      return false
  }
}
