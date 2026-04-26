/**
 * hermes-webview.ts
 *
 * Bridges webview messages from HermesTab.tsx → HermesStatusService / HermesClient / HermesPipeline.
 *
 * Message types handled:
 *   requestHermesStatus      → query current config + reachability, push hermesStatusUpdate
 *   hermesToggle             → toggle enabled/disabled
 *   hermesTestConnection     → ping /health, push hermesStatusUpdate
 *   hermesSetApiKey          → store key in SecretStorage
 *   hermesClearApiKey        → clear key from SecretStorage
 *   hermesUpdateConfig       → update a single config value (baseUrl | approvalMode)
 *   hermesSubmitTask         → submit a task via HermesPipeline
 *   requestHermesTasks       → fetch active tasks, push hermesTasksUpdate
 *   hermesAgentAssist        → run full settings audit via SettingsAgentAPI
 */

import * as vscode from "vscode"
import type { HermesStatusService } from "../../services/hermes/HermesStatusService"
import type { HermesClient } from "../../services/hermes/HermesClient"
import type { HermesPipeline } from "../../services/hermes/HermesPipeline"
import { saveKey, clearKey, keySource } from "../../services/hermes/secrets"
import type { ApprovalMode } from "../../services/hermes/types"
import { HERMES_CFG_SECTION } from "../../services/hermes/types"
import type { SettingsAgentAPI } from "../../services/SettingsAgentAPI"

export interface HermesWebviewContext {
  extensionContext: vscode.ExtensionContext
  status: HermesStatusService
  client: HermesClient
  pipeline: HermesPipeline
  settingsAgent: SettingsAgentAPI
  postMessage: (msg: unknown) => void
}

async function pushStatus(ctx: HermesWebviewContext): Promise<void> {
  const cfg = ctx.status.getConfig()
  const src = await keySource(ctx.extensionContext)

  let reachable = false
  let latency_ms = 0
  let version: string | undefined
  let error: string | undefined

  if (cfg.enabled) {
    try {
      const res = await ctx.client.health(5000)
      reachable = res.bridge_reachable && res.ok
      latency_ms = res.latency_ms
      version = res.version
      error = res.error
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  ctx.postMessage({
    type: "hermesStatusUpdate",
    status: {
      enabled: cfg.enabled,
      baseUrl: cfg.baseUrl,
      approvalMode: cfg.approvalMode,
      workspaceScopeOnly: cfg.workspaceScopeOnly,
      reachable,
      latency_ms,
      version,
      keySource: src,
      error,
    },
  })
}

async function pushTasks(ctx: HermesWebviewContext): Promise<void> {
  try {
    const tasks = await ctx.client.listTasks()
    ctx.postMessage({ type: "hermesTasksUpdate", tasks })
  } catch {
    ctx.postMessage({ type: "hermesTasksUpdate", tasks: [] })
  }
}

// eslint-disable-next-line complexity
export async function handleHermesWebviewMessage(
  msg: Record<string, unknown>,
  ctx: HermesWebviewContext,
): Promise<boolean> {
  switch (msg.type) {
    case "requestHermesStatus": {
      await pushStatus(ctx)
      return true
    }

    case "hermesToggle": {
      await ctx.status.toggle()
      await pushStatus(ctx)
      return true
    }

    case "hermesTestConnection": {
      await ctx.status.refresh()
      await pushStatus(ctx)
      return true
    }

    case "hermesSetApiKey": {
      const key = (msg.key as string | undefined)?.trim()
      if (key) {
        await saveKey(ctx.extensionContext, key)
        await ctx.status.refresh()
      }
      await pushStatus(ctx)
      return true
    }

    case "hermesClearApiKey": {
      await clearKey(ctx.extensionContext)
      await ctx.status.refresh()
      await pushStatus(ctx)
      return true
    }

    case "hermesUpdateConfig": {
      const key = msg.key as string
      const value = msg.value
      if (key === "baseUrl" || key === "approvalMode") {
        const cfg = vscode.workspace.getConfiguration(HERMES_CFG_SECTION)
        await cfg.update(key, value, vscode.ConfigurationTarget.Global)
        await ctx.status.refresh()
      }
      await pushStatus(ctx)
      return true
    }

    case "hermesSubmitTask": {
      try {
        const handle = await ctx.pipeline.submit({
          intent: (msg.description as string) ?? "",
          requiresExecution: (msg.task_type as string) !== "research",
          approvalMode: msg.auto_approve ? "auto-all" : undefined,
        })
        if (handle) {
          ctx.postMessage({ type: "hermesTaskSubmitted", taskId: handle.taskId, state: handle.initial })
        }
      } catch (e) {
        ctx.postMessage({ type: "hermesError", message: e instanceof Error ? e.message : String(e) })
      }
      return true
    }

    case "requestHermesTasks": {
      await pushTasks(ctx)
      return true
    }

    case "hermesAgentAssist": {
      try {
        const result = await ctx.settingsAgent.autoFillAll()
        const suggestions = await ctx.settingsAgent.getSuggestions()
        ctx.postMessage({
          type: "hermesAgentAssistResult",
          result: {
            filled: result.filled,
            failed: result.failed,
            suggestions: suggestions.map((s) => s.reason),
            auditFindings: suggestions.map((s) => `${s.setting}: ${s.reason}`),
          },
        })
      } catch (e) {
        ctx.postMessage({ type: "hermesError", message: e instanceof Error ? e.message : String(e) })
      }
      return true
    }

    default:
      return false
  }
}
