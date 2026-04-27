/**
 * governance-webview.ts (real-backend wiring, agent-A3-fix-governance-persistence)
 *
 * Bridges webview messages from GovernanceTab.tsx → Hub canonical-settings
 * service. Persists the 4-tier governance state at
 *   `${hubBaseUrl}/api/canonical-settings` under the `governance` key.
 *
 * Round-trip flow:
 *   UI mutation
 *     → vscode.postMessage({ type: "governance.update", payload })
 *     → POST ${hub}/api/canonical-settings   { key: "governance", value }
 *     → Hub writes audit log + persists
 *     → host pushes { type: "governance.update", payload } back to UI
 *
 *   UI mount
 *     → vscode.postMessage({ type: "governance.load" })
 *     → GET ${hub}/api/canonical-settings?key=governance
 *     → host pushes { type: "governance.update", payload } (Hub data, or
 *       defaults from .kilo/governance.json if Hub returns 404 / unreachable)
 *
 * Hub URL resolution order (matches auto-update):
 *   1. workspace setting `kilocode.updates.hubBaseUrl`
 *   2. workspace setting `daveai.hub.baseUrl`
 *   3. fallback `http://localhost:8095`
 *
 * Message types handled:
 *   governance.load   → push current state from Hub or defaults
 *   governance.update → POST diff to Hub, push round-tripped state
 *
 * NOTE: this handler is ADDITIVE. The existing in-process GovernanceService
 * (KiloProvider.dave.ts cases `requestGovernanceState` / `governanceSetTier`
 * / etc.) is unchanged. The new namespaced messages live alongside it so the
 * UI can opt in to canonical persistence without breaking the legacy path.
 */

import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"

// ─── Hub URL resolution ───────────────────────────────────────────────────

const HUB_DEFAULT = "http://localhost:8095"

export function resolveHubBaseUrl(): string {
  const updatesCfg = vscode.workspace.getConfiguration("kilocode.updates")
  const updatesUrl = updatesCfg.get<string>("hubBaseUrl")
  if (updatesUrl && updatesUrl.trim()) return updatesUrl.replace(/\/$/, "")

  const daveCfg = vscode.workspace.getConfiguration("daveai.hub")
  const daveUrl = daveCfg.get<string>("baseUrl")
  if (daveUrl && daveUrl.trim()) return daveUrl.replace(/\/$/, "")

  return HUB_DEFAULT
}

function adminToken(): string {
  return vscode.workspace.getConfiguration("daveai.hub").get<string>("adminToken", "")
}

function authHeaders(): Record<string, string> {
  const token = adminToken()
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

// ─── Default-state loader (.kilo/governance.json) ─────────────────────────

const GOV_KEY = "governance"
const GOV_DEFAULTS_REL = ".kilo/governance.json"

export interface GovernanceDefaults {
  tiers?: unknown[]
  tierAssignments?: unknown[]
  riskThresholds?: Record<string, unknown>
  pendingApprovals?: unknown[]
  resolvedApprovals?: unknown[]
  dangerousActions?: unknown[]
  auditLog?: unknown[]
  releaseVerdicts?: unknown[]
  [k: string]: unknown
}

function workspaceFolderForDefaults(): string | undefined {
  const folders = vscode.workspace.workspaceFolders
  if (folders && folders.length > 0) return folders[0].uri.fsPath
  return undefined
}

/**
 * Load the canonical default 4-tier governance state from
 * `<workspace>/.kilo/governance.json`. Falls back to a hard-coded skeleton
 * (matching the same 4-tier model) if the file is missing or unreadable.
 */
export function loadDefaultGovernanceState(workspaceFolder?: string): GovernanceDefaults {
  const folder = workspaceFolder ?? workspaceFolderForDefaults()
  if (folder) {
    const candidate = path.join(folder, GOV_DEFAULTS_REL)
    try {
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate, "utf-8")
        return JSON.parse(raw) as GovernanceDefaults
      }
    } catch {
      // fall through to hard-coded skeleton
    }
  }

  // Hard-coded skeleton — matches the 4-tier model from .kilo/governance.json.
  return {
    tiers: [
      { level: 0, name: "observer", permissions: ["view_audit", "view_status"] },
      {
        level: 1,
        name: "operator",
        permissions: ["view_audit", "view_status", "execute_safe_actions", "request_approval"],
      },
      {
        level: 2,
        name: "admin",
        permissions: [
          "view_audit",
          "view_status",
          "execute_safe_actions",
          "request_approval",
          "approve_actions",
          "manage_dangerous_actions",
          "create_release_verdict",
        ],
      },
      {
        level: 3,
        name: "superadmin",
        permissions: [
          "view_audit",
          "view_status",
          "execute_safe_actions",
          "request_approval",
          "approve_actions",
          "manage_dangerous_actions",
          "create_release_verdict",
          "manage_tiers",
          "override_blocks",
          "export_audit",
        ],
      },
    ],
    tierAssignments: [],
    riskThresholds: {
      low: { min: 0, max: 25 },
      medium: { min: 26, max: 50 },
      high: { min: 51, max: 75 },
      critical: { min: 76, max: 100 },
    },
    pendingApprovals: [],
    resolvedApprovals: [],
    dangerousActions: [],
    auditLog: [],
    releaseVerdicts: [],
  }
}

// ─── Hub fetcher (injectable for tests) ───────────────────────────────────

export type FetchInit = { method?: string; headers?: Record<string, string>; body?: string }
export type FetchResponseLike = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text?: () => Promise<string>
}
export type FetchLike = (input: string, init?: FetchInit) => Promise<FetchResponseLike>

export interface GovernanceWebviewContext {
  extensionContext: vscode.ExtensionContext
  postMessage: (msg: unknown) => void
  /** Optional override for unit tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: FetchLike
  /** Optional override for the workspace folder used to find defaults. */
  workspaceFolder?: string
  /** Optional override for the resolved hub base URL (test seam). */
  hubBaseUrl?: string
}

function getHubBaseUrl(ctx: GovernanceWebviewContext): string {
  return ctx.hubBaseUrl ?? resolveHubBaseUrl()
}

function getFetch(ctx: GovernanceWebviewContext): FetchLike {
  const f = ctx.fetchImpl ?? ((globalThis as unknown as { fetch?: FetchLike }).fetch)
  if (!f) {
    throw new Error("No fetch implementation available — provide ctx.fetchImpl")
  }
  return f
}

// ─── Hub round-trip helpers ───────────────────────────────────────────────

type HubResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; reason: string }

async function hubLoad(ctx: GovernanceWebviewContext): Promise<HubResult> {
  const url = `${getHubBaseUrl(ctx)}/api/canonical-settings?key=${encodeURIComponent(GOV_KEY)}`
  try {
    const res = await getFetch(ctx)(url, { method: "GET", headers: authHeaders() })
    if (!res.ok) return { ok: false, status: res.status, reason: `HTTP ${res.status}` }
    const body = (await res.json()) as { value?: unknown; governance?: unknown }
    const data = (body && typeof body === "object" ? body.value ?? body.governance : undefined) ?? body
    return { ok: true, data }
  } catch (err) {
    return { ok: false, status: 0, reason: err instanceof Error ? err.message : String(err) }
  }
}

async function hubSave(ctx: GovernanceWebviewContext, payload: unknown): Promise<HubResult> {
  const url = `${getHubBaseUrl(ctx)}/api/canonical-settings`
  try {
    const res = await getFetch(ctx)(url, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ key: GOV_KEY, value: payload }),
    })
    if (!res.ok) return { ok: false, status: res.status, reason: `HTTP ${res.status}` }
    const body = (await res.json()) as { value?: unknown; governance?: unknown }
    const data = (body && typeof body === "object" ? body.value ?? body.governance : undefined) ?? payload
    return { ok: true, data }
  } catch (err) {
    return { ok: false, status: 0, reason: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Public message handler ───────────────────────────────────────────────

/**
 * Handle a webview message addressed to the canonical-settings governance
 * round-trip. Returns true when the message was consumed, false otherwise
 * so the caller's outer dispatcher can keep looking.
 */
export async function handleGovernanceRealWebviewMessage(
  message: Record<string, unknown>,
  ctx: GovernanceWebviewContext,
): Promise<boolean> {
  const type = message?.type
  if (type !== "governance.load" && type !== "governance.update") return false

  if (type === "governance.load") {
    const result = await hubLoad(ctx)
    if (result.ok) {
      ctx.postMessage({ type: "governance.update", payload: result.data, source: "hub" })
    } else {
      const defaults = loadDefaultGovernanceState(ctx.workspaceFolder)
      ctx.postMessage({
        type: "governance.update",
        payload: defaults,
        source: "defaults",
        warning: `Hub unreachable (${result.reason}); using .kilo/governance.json defaults.`,
      })
    }
    return true
  }

  // type === "governance.update"
  const payload = (message as { payload?: unknown }).payload
  if (payload === undefined || payload === null) {
    ctx.postMessage({
      type: "governance.error",
      reason: "governance.update requires a payload",
    })
    return true
  }

  const result = await hubSave(ctx, payload)
  if (result.ok) {
    ctx.postMessage({ type: "governance.update", payload: result.data, source: "hub" })
  } else {
    // Tell the UI the save failed and to revert. We did NOT persist.
    ctx.postMessage({
      type: "governance.error",
      reason: `Hub save failed: ${result.reason}`,
      revert: true,
    })
    // Re-emit the last known good Hub state (or defaults) so UI rolls back.
    const reloaded = await hubLoad(ctx)
    if (reloaded.ok) {
      ctx.postMessage({ type: "governance.update", payload: reloaded.data, source: "hub" })
    } else {
      const defaults = loadDefaultGovernanceState(ctx.workspaceFolder)
      ctx.postMessage({ type: "governance.update", payload: defaults, source: "defaults" })
    }
  }
  return true
}
