import type * as vscode from "vscode"
import { resolveKey } from "./secrets"
import type { HermesConfig, HermesHealth, TaskCreated, TaskEnvelope, TaskEvent, TaskStatus } from "./types"

/**
 * HTTP client for the Hermes Bridge API.
 *
 * Bridge A endpoints (KiloCode ↔ Hermes) — KiloCode ONLY calls this surface.
 * KiloCode MUST NOT call Bridge B (/jobs, internal Hermes ↔ ZeroClaw).
 */
export class HermesClient {
  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private cfg: HermesConfig,
  ) {}

  /** Swap in a new config (called when the user edits settings). */
  setConfig(cfg: HermesConfig): void {
    this.cfg = cfg
  }

  getConfig(): HermesConfig {
    return this.cfg
  }

  /** Ping the Bridge API. Always returns (never throws). */
  async health(timeoutMs = 3000): Promise<HermesHealth> {
    const started = Date.now()
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    const url = this.url("/health")
    const res = await fetch(url, {
      method: "GET",
      signal: ctl.signal,
      headers: await this.headers(),
    }).catch((err: unknown) => {
      console.warn("[Kilo Hermes] health ping failed:", err)
      return undefined
    })
    clearTimeout(timer)
    const latency = Date.now() - started
    if (!res) {
      return { ok: false, latency_ms: latency, bridge_reachable: false, error: "network" }
    }
    if (!res.ok) {
      return {
        ok: false,
        latency_ms: latency,
        bridge_reachable: true,
        error: `HTTP ${res.status}`,
      }
    }
    const body = (await res.json().catch(() => ({}))) as { status?: string; version?: string }
    return {
      ok: body.status === "ok" || body.status === undefined,
      version: body.version,
      latency_ms: latency,
      bridge_reachable: true,
    }
  }

  /** POST /tasks — returns task_id + initial state. */
  async postTask(env: TaskEnvelope): Promise<TaskCreated> {
    const res = await fetch(this.url("/tasks"), {
      method: "POST",
      headers: { ...(await this.headers()), "content-type": "application/json" },
      body: JSON.stringify(env),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`[Hermes] POST /tasks ${res.status}: ${text || res.statusText}`)
    }
    return (await res.json()) as TaskCreated
  }

  /** GET /tasks — list all active tasks. */
  async listTasks(): Promise<TaskStatus[]> {
    const res = await fetch(this.url("/tasks"), {
      method: "GET",
      headers: await this.headers(),
    })
    if (!res.ok) throw new Error(`[Hermes] GET /tasks ${res.status}`)
    return (await res.json()) as TaskStatus[]
  }

  /** GET /tasks/{id}. */
  async getTask(id: string): Promise<TaskStatus> {
    const res = await fetch(this.url(`/tasks/${encodeURIComponent(id)}`), {
      method: "GET",
      headers: await this.headers(),
    })
    if (!res.ok) throw new Error(`[Hermes] GET /tasks/${id} ${res.status}`)
    return (await res.json()) as TaskStatus
  }

  /** POST /tasks/{id}/approve. */
  async approve(id: string): Promise<TaskStatus> {
    const res = await fetch(this.url(`/tasks/${encodeURIComponent(id)}/approve`), {
      method: "POST",
      headers: await this.headers(),
    })
    if (!res.ok) throw new Error(`[Hermes] approve failed ${res.status}`)
    return (await res.json()) as TaskStatus
  }

  /** POST /tasks/{id}/cancel. */
  async cancel(id: string): Promise<TaskStatus> {
    const res = await fetch(this.url(`/tasks/${encodeURIComponent(id)}/cancel`), {
      method: "POST",
      headers: await this.headers(),
    })
    if (!res.ok) throw new Error(`[Hermes] cancel failed ${res.status}`)
    return (await res.json()) as TaskStatus
  }

  /**
   * Subscribe to GET /tasks/{id}/events (Server-Sent Events).
   * Returns an unsubscribe function that aborts the stream.
   */
  subscribe(id: string, onEvent: (e: TaskEvent) => void): () => void {
    const ctl = new AbortController()
    void this.stream(id, ctl, onEvent)
    return () => ctl.abort()
  }

  private async stream(
    id: string,
    ctl: AbortController,
    onEvent: (e: TaskEvent) => void,
  ): Promise<void> {
    const res = await fetch(this.url(`/tasks/${encodeURIComponent(id)}/events`), {
      method: "GET",
      headers: { ...(await this.headers()), accept: "text/event-stream" },
      signal: ctl.signal,
    }).catch((err: unknown) => {
      console.warn("[Kilo Hermes] SSE connect failed:", err)
      return undefined
    })
    if (!res || !res.ok || !res.body) return

    const reader = res.body.getReader()
    const dec = new TextDecoder()
    const buf: string[] = []

    while (!ctl.signal.aborted) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }) as const)
      if (done) return
      if (!value) continue
      const chunk = dec.decode(value, { stream: true })
      buf.push(chunk)
      const joined = buf.join("")
      const lines = joined.split("\n")
      buf.length = 0
      buf.push(lines.pop() ?? "")
      for (const line of lines) {
        if (!line.startsWith("data:")) continue
        const payload = line.slice(5).trim()
        if (payload.length === 0) continue
        const parsed = tryParse<TaskEvent>(payload)
        if (parsed) onEvent(parsed)
      }
    }
  }

  private url(path: string): string {
    const base = this.cfg.baseUrl.replace(/\/+$/, "")
    return `${base}${path}`
  }

  private async headers(): Promise<Record<string, string>> {
    const out: Record<string, string> = { "x-kilo-source": "kilo-vscode" }
    const key = await resolveKey(this.ctx)
    if (key) {
      out.authorization = `Bearer ${key}`
      out["x-hermes-key"] = key
    }
    return out
  }
}

function tryParse<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    console.warn("[Kilo Hermes] SSE parse failed:", err)
    return undefined
  }
}
