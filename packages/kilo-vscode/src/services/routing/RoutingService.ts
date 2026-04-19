import * as vscode from "vscode"
import { KiloLogger } from "../KiloLogger"

// ─── Types ───────────────────────────────────────────────

export interface ProviderConfig {
  id: string
  name: string
  apiBase?: string
  apiKeyConfigured: boolean
  roles: string[]
  status: "healthy" | "degraded" | "offline" | "unconfigured"
  lastHealthCheck?: number
  circuitBreaker: "closed" | "open" | "half-open"
  requestCount: number
  failureCount: number
  estimatedCost: number
  wrongRoleBlocks: number
  retriesUsed: number
}

export interface RouteDecision {
  taskType: string
  riskLevel: string
  primaryProvider: string
  fallbackProvider?: string
  reason: string
  timestamp: number
  success: boolean
  fallbackUsed: boolean
  fallbackDepth: number
  trace: RouteTraceStep[]
}

export interface RouteTraceStep {
  step: string
  provider?: string
  result: "selected" | "skipped" | "blocked" | "failed"
  reason: string
  timestamp: number
}

export interface RouteRequest {
  taskType:
    | "contract"
    | "architecture"
    | "audit"
    | "execution"
    | "fallback_test"
    | "local_private"
    | "memory_check"
    | "training_orchestration"
  riskLevel: "low" | "medium" | "high"
  privacyMode: "local_preferred" | "cloud_ok"
  requiredCapabilities: string[]
}

export interface RoutingConfig {
  mode: "auto" | "manual"
  fallbackOrder: string[]
  privacyMode: "local_preferred" | "cloud_ok"
  costThreshold: number
  maxFallbackDepth: number
  retryBudget: number
}

export interface HealthSummary {
  providers: ProviderConfig[]
  totalRequests: number
  totalFailures: number
  totalCost: number
  totalWrongRoleBlocks: number
}

// ─── Constants ───────────────────────────────────────────

const ROLE_CONTRACTS = "Contract Writing"
const ROLE_ARCHITECTURE = "Architecture"
const ROLE_AUDITS = "Audits"
const ROLE_RELEASE = "Release Verdicts"
const ROLE_EXECUTION = "Execution Worker"
const ROLE_FALLBACK = "Fallback"
const ROLE_LOCAL = "Local/Private"

const ALL_ROLES = [
  ROLE_CONTRACTS,
  ROLE_ARCHITECTURE,
  ROLE_AUDITS,
  ROLE_RELEASE,
  ROLE_EXECUTION,
  ROLE_FALLBACK,
  ROLE_LOCAL,
]

const TASK_TO_ROLES: Record<string, string[]> = {
  contract: [ROLE_CONTRACTS],
  architecture: [ROLE_ARCHITECTURE],
  audit: [ROLE_AUDITS],
  execution: [ROLE_EXECUTION],
  fallback_test: [ROLE_FALLBACK],
  local_private: [ROLE_LOCAL],
  memory_check: [ROLE_EXECUTION, ROLE_LOCAL],
  training_orchestration: [ROLE_EXECUTION, ROLE_ARCHITECTURE],
}

/** Cost per request (estimated, in USD) */
const PROVIDER_COST: Record<string, number> = {
  claude: 0.003,
  minimax: 0.001,
  siliconflow: 0.0005,
  ollama: 0,
  lmstudio: 0,
}

const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5
const CIRCUIT_BREAKER_RECOVERY_MS = 30_000
const MAX_TRACE_ENTRIES = 25

// ─── Service ─────────────────────────────────────────────

export class RoutingService implements vscode.Disposable {
  private providers: Map<string, ProviderConfig> = new Map()
  private traces: RouteDecision[] = []
  private config: RoutingConfig
  private circuitTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private healthTimer: ReturnType<typeof setInterval> | undefined
  private retryBudgetTimer: ReturnType<typeof setInterval> | undefined
  private readonly listeners = new Set<() => void>()
  private readonly secrets: vscode.SecretStorage
  private readonly log = KiloLogger.for("RoutingService")

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets
    this.config = {
      mode: "auto",
      fallbackOrder: ["claude", "minimax", "siliconflow", "ollama", "lmstudio"],
      privacyMode: "cloud_ok",
      costThreshold: 10.0,
      maxFallbackDepth: 3,
      retryBudget: 5,
    }
    this.initializeProviders()
    // Run initial health check immediately so Ollama/LM Studio don't stay stuck on "offline"
    // if they're actually running. Delayed by 1s to let extension activation finish.
    setTimeout(() => {
      void this.runHealthChecks().catch((err) => this.log.warn("Initial health check failed", err))
    }, 1000)
    this.healthTimer = setInterval(() => {
      void this.runHealthChecks()
    }, 60_000)

    // Reset retry budgets for all providers every hour
    this.retryBudgetTimer = setInterval(() => {
      this.resetRetryBudgets()
    }, 3_600_000)

    this.log.info("RoutingService initialized", {
      mode: this.config.mode,
      providers: this.config.fallbackOrder,
    })
  }

  // ── Provider Initialization ──────────────────────────────

  private initializeProviders(): void {
    const defaults: Array<{
      id: string
      name: string
      apiBase?: string
      roles: string[]
    }> = [
      {
        id: "claude",
        name: "Claude",
        apiBase: "https://api.anthropic.com/v1",
        roles: [ROLE_CONTRACTS, ROLE_AUDITS, ROLE_ARCHITECTURE, ROLE_RELEASE],
      },
      // MiniMax: standard always-on execution provider
      {
        id: "minimax",
        name: "MiniMax",
        apiBase: "https://api.minimax.chat/v1",
        roles: [ROLE_EXECUTION],
      },
      {
        id: "siliconflow",
        name: "SiliconFlow",
        apiBase: "https://api.siliconflow.com/v1", // Dashboard at cloud.siliconflow.com/me/account/ak
        roles: [ROLE_FALLBACK],
      },
      {
        id: "ollama",
        name: "Ollama",
        apiBase: "http://localhost:11434",
        roles: [ROLE_LOCAL, ROLE_EXECUTION],
      },
      {
        id: "lmstudio",
        name: "LM Studio",
        apiBase: "http://localhost:1234",
        roles: [ROLE_LOCAL],
      },
    ]

    for (const def of defaults) {
      this.providers.set(def.id, {
        id: def.id,
        name: def.name,
        apiBase: def.apiBase,
        apiKeyConfigured: false,
        roles: def.roles,
        status: "unconfigured",
        lastHealthCheck: undefined,
        circuitBreaker: "closed",
        requestCount: 0,
        failureCount: 0,
        estimatedCost: 0,
        wrongRoleBlocks: 0,
        retriesUsed: 0,
      })
    }

    // Local providers do not require API keys
    const ollama = this.providers.get("ollama")!
    ollama.status = "offline"
    const lmstudio = this.providers.get("lmstudio")!
    lmstudio.status = "offline"
  }

  // ── Public API ───────────────────────────────────────────

  getProviders(): ProviderConfig[] {
    return Array.from(this.providers.values())
  }

  getProvider(id: string): ProviderConfig | undefined {
    return this.providers.get(id)
  }

  getTraces(): RouteDecision[] {
    return [...this.traces]
  }

  getConfig(): RoutingConfig {
    return { ...this.config }
  }

  getHealthSummary(): HealthSummary {
    const providers = this.getProviders()
    return {
      providers,
      totalRequests: providers.reduce((s, p) => s + p.requestCount, 0),
      totalFailures: providers.reduce((s, p) => s + p.failureCount, 0),
      totalCost: providers.reduce((s, p) => s + p.estimatedCost, 0),
      totalWrongRoleBlocks: providers.reduce((s, p) => s + p.wrongRoleBlocks, 0),
    }
  }

  getAllRoles(): string[] {
    return [...ALL_ROLES]
  }

  // ── Configuration ────────────────────────────────────────

  setMode(mode: "auto" | "manual"): void {
    this.log.info("Routing mode changed", { mode })
    this.config.mode = mode
    this.notifyListeners()
  }

  setFallbackOrder(order: string[]): void {
    // Validate all IDs exist
    const valid = order.filter((id) => this.providers.has(id))
    this.config.fallbackOrder = valid
    this.notifyListeners()
  }

  setPrivacyMode(mode: "local_preferred" | "cloud_ok"): void {
    this.log.info("Privacy mode changed", { privacyMode: mode })
    this.config.privacyMode = mode
    this.notifyListeners()
  }

  setCostThreshold(threshold: number): void {
    this.log.info("Cost threshold changed", { costThreshold: Math.max(0, threshold) })
    this.config.costThreshold = Math.max(0, threshold)
    this.notifyListeners()
  }

  setRole(providerId: string, role: string, enabled: boolean): void {
    const provider = this.providers.get(providerId)
    if (!provider) return

    if (enabled && !provider.roles.includes(role)) {
      provider.roles.push(role)
    } else if (!enabled) {
      provider.roles = provider.roles.filter((r) => r !== role)
    }
    this.notifyListeners()
  }

  /**
   * Configure an API key for a provider.
   * Pass the actual key string to store it in VS Code SecretStorage,
   * or pass undefined/empty to clear it.
   */
  async configureApiKey(providerId: string, apiKey: string | undefined): Promise<void> {
    const provider = this.providers.get(providerId)
    if (!provider) return

    this.log.info("API key configured", { providerId })
    const secretKey = `kilo-routing-key-${providerId}`

    if (apiKey && apiKey.trim().length > 0) {
      // Store the real API key in VS Code's secure secret storage
      await this.secrets.store(secretKey, apiKey.trim())
      provider.apiKeyConfigured = true
      if (provider.status === "unconfigured") {
        provider.status = "healthy"
      }
    } else {
      // Clear the stored key
      await this.secrets.delete(secretKey)
      provider.apiKeyConfigured = false
      provider.status = "unconfigured"
    }
    this.notifyListeners()
  }

  /** Retrieve a stored API key from SecretStorage (for health checks / API calls). */
  async getApiKey(providerId: string): Promise<string | undefined> {
    return this.secrets.get(`kilo-routing-key-${providerId}`)
  }

  // ── Routing ──────────────────────────────────────────────

  route(request: RouteRequest): RouteDecision {
    const trace: RouteTraceStep[] = []
    const now = Date.now()

    // Validate required fields before routing
    if (!this.validateRouteRequest(request)) {
      return this.recordDecision({
        taskType: request.taskType ?? "unknown",
        riskLevel: request.riskLevel ?? "unknown",
        primaryProvider: "none",
        reason: "Route validation failed: missing or invalid required fields",
        timestamp: now,
        success: false,
        fallbackUsed: false,
        fallbackDepth: 0,
        trace: [{
          step: "validation",
          result: "failed",
          reason: "Request missing required fields (taskType, riskLevel)",
          timestamp: now,
        }],
      })
    }

    // Determine which roles satisfy this task
    const requiredRoles = TASK_TO_ROLES[request.taskType] ?? [ROLE_EXECUTION]

    trace.push({
      step: "resolve_roles",
      result: "selected",
      reason: `Task "${request.taskType}" requires roles: ${requiredRoles.join(", ")}`,
      timestamp: now,
    })

    // Build candidate list from providers that have at least one matching role
    const candidates = this.buildCandidateList(request, requiredRoles, trace, now)

    // Select primary provider
    const primary = candidates[0]
    if (!primary) {
      const decision = this.recordDecision({
        taskType: request.taskType,
        riskLevel: request.riskLevel,
        primaryProvider: "none",
        reason: "No available provider for the required roles",
        timestamp: now,
        success: false,
        fallbackUsed: false,
        fallbackDepth: 0,
        trace,
      })
      return decision
    }

    // Select fallback provider (next candidate after primary)
    const fallback = candidates.length > 1 ? candidates[1] : undefined

    trace.push({
      step: "select_primary",
      provider: primary.id,
      result: "selected",
      reason: `Primary provider selected: ${primary.name}`,
      timestamp: Date.now(),
    })

    if (fallback) {
      trace.push({
        step: "select_fallback",
        provider: fallback.id,
        result: "selected",
        reason: `Fallback provider: ${fallback.name}`,
        timestamp: Date.now(),
      })
    }

    // Track the request
    primary.requestCount++
    primary.estimatedCost += PROVIDER_COST[primary.id] ?? 0

    const decision = this.recordDecision({
      taskType: request.taskType,
      riskLevel: request.riskLevel,
      primaryProvider: primary.id,
      fallbackProvider: fallback?.id,
      reason: this.buildReason(primary, request, requiredRoles),
      timestamp: now,
      success: true,
      fallbackUsed: false,
      fallbackDepth: 0,
      trace,
    })

    this.log.info("Route decision", {
      taskType: request.taskType,
      riskLevel: request.riskLevel,
      primaryProvider: primary.id,
      fallbackProvider: fallback?.id,
      success: true,
    })
    this.log.debug("Route trace", { trace: decision.trace })

    this.notifyListeners()
    return decision
  }

  /**
   * Report that a provider request succeeded. Closes circuit breaker
   * if it was half-open.
   */
  reportSuccess(providerId: string): void {
    const provider = this.providers.get(providerId)
    if (!provider) return

    if (provider.circuitBreaker === "half-open") {
      provider.circuitBreaker = "closed"
      provider.failureCount = 0
      const timer = this.circuitTimers.get(providerId)
      if (timer) {
        clearTimeout(timer)
        this.circuitTimers.delete(providerId)
      }
    }
    this.notifyListeners()
  }

  /**
   * Report that a provider request failed. Opens circuit breaker
   * after CIRCUIT_BREAKER_FAILURE_THRESHOLD consecutive failures.
   */
  reportFailure(providerId: string): void {
    const provider = this.providers.get(providerId)
    if (!provider) return

    provider.failureCount++

    if (provider.failureCount >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      this.openCircuitBreaker(providerId)
    }

    // If degradation threshold reached (but not fully open yet)
    if (
      provider.failureCount >= Math.ceil(CIRCUIT_BREAKER_FAILURE_THRESHOLD / 2) &&
      provider.circuitBreaker === "closed"
    ) {
      provider.status = "degraded"
    }

    this.notifyListeners()
  }

  /**
   * Execute a fallback: route again excluding the failed provider.
   * Returns the new decision with fallbackUsed=true.
   * Enforces fallback chain depth limit and per-provider retry budget.
   */
  executeFallback(
    originalDecision: RouteDecision,
    failedProviderId: string,
  ): RouteDecision {
    this.reportFailure(failedProviderId)

    const currentDepth = (originalDecision.fallbackDepth ?? 0) + 1

    // Find original trace entry count
    const trace: RouteTraceStep[] = [
      ...originalDecision.trace,
      {
        step: "fallback_trigger",
        provider: failedProviderId,
        result: "failed",
        reason: `Provider ${failedProviderId} failed, triggering fallback (depth ${currentDepth})`,
        timestamp: Date.now(),
      },
    ]

    // Enforce fallback chain depth limit
    if (currentDepth > this.config.maxFallbackDepth) {
      trace.push({
        step: "fallback_depth_exceeded",
        result: "failed",
        reason: `Fallback depth ${currentDepth} exceeds max ${this.config.maxFallbackDepth}`,
        timestamp: Date.now(),
      })
      return this.recordDecision({
        ...originalDecision,
        success: false,
        fallbackUsed: true,
        fallbackDepth: currentDepth,
        reason: `${originalDecision.reason} | Fallback chain depth limit exceeded (${currentDepth}/${this.config.maxFallbackDepth})`,
        trace,
      })
    }

    const fallbackId = originalDecision.fallbackProvider
    if (!fallbackId) {
      return this.recordDecision({
        ...originalDecision,
        success: false,
        fallbackUsed: true,
        fallbackDepth: currentDepth,
        reason: `${originalDecision.reason} | Fallback: no fallback provider available`,
        trace,
      })
    }

    const fallback = this.providers.get(fallbackId)
    if (!fallback || !this.isProviderAvailable(fallback)) {
      trace.push({
        step: "fallback_unavailable",
        provider: fallbackId,
        result: "failed",
        reason: `Fallback provider ${fallbackId} is not available`,
        timestamp: Date.now(),
      })
      return this.recordDecision({
        ...originalDecision,
        success: false,
        fallbackUsed: true,
        fallbackDepth: currentDepth,
        reason: `${originalDecision.reason} | Fallback provider unavailable`,
        trace,
      })
    }

    // Check retry budget for the fallback provider
    if (fallback.retriesUsed >= this.config.retryBudget) {
      trace.push({
        step: "retry_budget_exhausted",
        provider: fallbackId,
        result: "skipped",
        reason: `Provider ${fallback.name} retry budget exhausted (${fallback.retriesUsed}/${this.config.retryBudget})`,
        timestamp: Date.now(),
      })
      return this.recordDecision({
        ...originalDecision,
        success: false,
        fallbackUsed: true,
        fallbackDepth: currentDepth,
        reason: `${originalDecision.reason} | Fallback provider ${fallbackId} retry budget exhausted`,
        trace,
      })
    }

    fallback.retriesUsed++
    fallback.requestCount++
    fallback.estimatedCost += PROVIDER_COST[fallback.id] ?? 0

    trace.push({
      step: "fallback_execute",
      provider: fallbackId,
      result: "selected",
      reason: `Routed to fallback provider: ${fallback.name}`,
      timestamp: Date.now(),
    })

    const decision = this.recordDecision({
      taskType: originalDecision.taskType,
      riskLevel: originalDecision.riskLevel,
      primaryProvider: fallbackId,
      reason: `Fallback from ${failedProviderId} to ${fallbackId}`,
      timestamp: Date.now(),
      success: true,
      fallbackUsed: true,
      fallbackDepth: currentDepth,
      trace,
    })

    this.notifyListeners()
    return decision
  }

  // ── Health Checks ────────────────────────────────────────

  /**
   * Test a provider by making a real HTTP request.
   * - Local providers: GET to localhost endpoint
   * - Cloud providers: lightweight API call with stored key
   */
  async testProvider(providerId: string): Promise<boolean> {
    const provider = this.providers.get(providerId)
    if (!provider) return false

    this.log.info("Testing provider health", { providerId })
    const endTimer = this.log.time(`healthCheck:${providerId}`)

    provider.lastHealthCheck = Date.now()

    const isLocal = providerId === "ollama" || providerId === "lmstudio"

    if (!isLocal && !provider.apiKeyConfigured) {
      provider.status = "unconfigured"
      endTimer()
      this.notifyListeners()
      return false
    }

    try {
      if (isLocal) {
        // Local providers: ping localhost
        const port = providerId === "ollama" ? 11434 : 1234
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 3000)
        try {
          const res = await fetch(`http://localhost:${port}/`, {
            method: "GET",
            signal: controller.signal,
          }).catch(() => undefined)
          clearTimeout(timeout)
          if (res && res.ok) {
            provider.status = "healthy"
            provider.apiKeyConfigured = true
            if (provider.circuitBreaker === "open") {
              provider.circuitBreaker = "half-open"
            }
            endTimer()
            this.notifyListeners()
            return true
          }
        } catch {
          clearTimeout(timeout)
        }
        provider.status = "offline"
        endTimer()
        this.notifyListeners()
        return false
      }

      // Cloud providers: make a real API call to validate the key
      const apiKey = await this.getApiKey(providerId)
      if (!apiKey) {
        provider.status = "unconfigured"
        provider.apiKeyConfigured = false
        endTimer()
        this.notifyListeners()
        return false
      }

      const healthy = await this.testCloudProvider(providerId, apiKey, provider.apiBase)
      if (healthy) {
        provider.status = "healthy"
        if (provider.circuitBreaker === "open") {
          provider.circuitBreaker = "half-open"
        }
      } else {
        provider.status = "degraded"
      }
      endTimer()
      this.notifyListeners()
      return healthy
    } catch {
      provider.status = "offline"
      endTimer()
      this.notifyListeners()
      return false
    }
  }

  /**
   * Make a real lightweight API call to a cloud provider to validate connectivity and key.
   * Each provider has a different health check endpoint:
   * - Claude: GET /v1/models (Anthropic list models)
   * - MiniMax: POST /v1/text/chatcompletion (lightweight ping)
   * - SiliconFlow: GET /v1/models
   */
  private async testCloudProvider(providerId: string, apiKey: string, apiBase?: string): Promise<boolean> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
      let url: string
      let headers: Record<string, string>
      let method = "GET"

      switch (providerId) {
        case "claude":
          url = `${apiBase ?? "https://api.anthropic.com/v1"}/models`
          headers = {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          }
          break
        case "minimax":
          // MiniMax: list models endpoint
          url = `${apiBase ?? "https://api.minimax.chat/v1"}/models`
          headers = {
            "Authorization": `Bearer ${apiKey}`,
          }
          break
        case "siliconflow":
          url = `${apiBase ?? "https://api.siliconflow.com/v1"}/models`
          headers = {
            "Authorization": `Bearer ${apiKey}`,
          }
          break
        default:
          // Unknown cloud provider — try generic OpenAI-compatible /models endpoint
          url = `${apiBase ?? "https://api.openai.com/v1"}/models`
          headers = {
            "Authorization": `Bearer ${apiKey}`,
          }
          break
      }

      const res = await fetch(url, {
        method,
        headers,
        signal: controller.signal,
      }).catch(() => undefined)

      clearTimeout(timeout)

      if (!res) return false

      // 200 = healthy, 401 = bad key (still reachable), 403 = key valid but insufficient perms
      if (res.ok) return true
      if (res.status === 401 || res.status === 403) {
        // Key is invalid or insufficient — provider is reachable but key is bad
        this.log.warn("Provider returned auth error — API key may be invalid", { providerId, status: res.status })
        return false
      }
      // 429 (rate limited) or 5xx (server error) — provider is reachable but degraded
      if (res.status === 429 || res.status >= 500) {
        return true // Provider exists but is temporarily impaired
      }
      return false
    } catch {
      clearTimeout(timeout)
      return false
    }
  }

  /** Run health checks for all configured providers. */
  async runHealthChecks(): Promise<void> {
    const providers = this.getProviders()
    for (const p of providers) {
      if (p.status !== "unconfigured") {
        const result = await this.testProvider(p.id)
        this.log.debug("Health check result", { providerId: p.id, healthy: result, status: p.status })
      }
    }
  }

  // ── Listener Management ──────────────────────────────────

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  // ── Dispose ──────────────────────────────────────────────

  dispose(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = undefined
    }
    if (this.retryBudgetTimer) {
      clearInterval(this.retryBudgetTimer)
      this.retryBudgetTimer = undefined
    }
    for (const timer of this.circuitTimers.values()) {
      clearTimeout(timer)
    }
    this.circuitTimers.clear()
    this.listeners.clear()
    this.providers.clear()
    this.traces = []
  }

  // ── Private Helpers ──────────────────────────────────────

  private buildCandidateList(
    request: RouteRequest,
    requiredRoles: string[],
    trace: RouteTraceStep[],
    now: number,
  ): ProviderConfig[] {
    const candidates: ProviderConfig[] = []
    const order =
      this.config.mode === "auto"
        ? this.config.fallbackOrder
        : this.config.fallbackOrder

    for (const pid of order) {
      const provider = this.providers.get(pid)
      if (!provider) continue

      // Check role match
      const hasRole = provider.roles.some((r) => requiredRoles.includes(r))
      if (!hasRole) {
        provider.wrongRoleBlocks++
        trace.push({
          step: "role_check",
          provider: pid,
          result: "blocked",
          reason: `${provider.name} lacks required roles: ${requiredRoles.join(", ")}`,
          timestamp: now,
        })
        continue
      }

      // Check availability
      if (!this.isProviderAvailable(provider)) {
        trace.push({
          step: "availability_check",
          provider: pid,
          result: "skipped",
          reason: `${provider.name} is ${provider.status} (circuit: ${provider.circuitBreaker})`,
          timestamp: now,
        })
        continue
      }

      // Check privacy mode
      if (request.privacyMode === "local_preferred") {
        const isLocal = pid === "ollama" || pid === "lmstudio"
        if (!isLocal && candidates.some((c) => c.id === "ollama" || c.id === "lmstudio")) {
          trace.push({
            step: "privacy_check",
            provider: pid,
            result: "skipped",
            reason: `Privacy mode prefers local; ${provider.name} is cloud-based and a local provider is available`,
            timestamp: now,
          })
          continue
        }
        // Prioritize local providers by inserting them at front
        if (isLocal) {
          candidates.unshift(provider)
          trace.push({
            step: "privacy_boost",
            provider: pid,
            result: "selected",
            reason: `${provider.name} prioritized (local provider, privacy mode)`,
            timestamp: now,
          })
          continue
        }
      }

      // Enforce cost cap: if accumulated cost exceeds total budget, mark temporarily unavailable
      const totalBudget = this.config.costThreshold * 10
      if (provider.estimatedCost >= totalBudget) {
        provider.status = "offline"
        trace.push({
          step: "cost_cap",
          provider: pid,
          result: "blocked",
          reason: `${provider.name} cost cap exceeded ($${provider.estimatedCost.toFixed(4)} >= $${totalBudget.toFixed(2)} total budget) — marked temporarily unavailable`,
          timestamp: now,
        })
        continue
      }

      // Check cost threshold
      if (provider.estimatedCost >= this.config.costThreshold) {
        trace.push({
          step: "cost_check",
          provider: pid,
          result: "skipped",
          reason: `${provider.name} exceeded cost threshold ($${provider.estimatedCost.toFixed(4)} >= $${this.config.costThreshold.toFixed(2)})`,
          timestamp: now,
        })
        continue
      }

      // High-risk tasks prefer Claude
      if (request.riskLevel === "high" && pid !== "claude" && this.isProviderAvailable(this.providers.get("claude"))) {
        // Still add as candidate but not first if Claude is available
        trace.push({
          step: "risk_check",
          provider: pid,
          result: "selected",
          reason: `${provider.name} added as candidate (high-risk task prefers Claude as primary)`,
          timestamp: now,
        })
        candidates.push(provider)
        continue
      }

      trace.push({
        step: "candidate_add",
        provider: pid,
        result: "selected",
        reason: `${provider.name} added as candidate`,
        timestamp: now,
      })
      candidates.push(provider)
    }

    return candidates
  }

  private isProviderAvailable(provider: ProviderConfig | undefined): boolean {
    if (!provider) return false
    if (provider.status === "offline" || provider.status === "unconfigured") return false
    if (provider.circuitBreaker === "open") return false
    return true
  }

  private openCircuitBreaker(providerId: string): void {
    const provider = this.providers.get(providerId)
    if (!provider) return

    provider.circuitBreaker = "open"
    provider.status = "offline"

    // Clear any existing recovery timer
    const existing = this.circuitTimers.get(providerId)
    if (existing) clearTimeout(existing)

    // After recovery timeout, move to half-open
    const timer = setTimeout(() => {
      const p = this.providers.get(providerId)
      if (p && p.circuitBreaker === "open") {
        p.circuitBreaker = "half-open"
        p.status = "degraded"
        this.notifyListeners()
      }
      this.circuitTimers.delete(providerId)
    }, CIRCUIT_BREAKER_RECOVERY_MS)

    this.circuitTimers.set(providerId, timer)
  }

  private buildReason(
    provider: ProviderConfig,
    request: RouteRequest,
    roles: string[],
  ): string {
    const parts: string[] = []

    if (request.riskLevel === "high") {
      parts.push("high-risk task")
    }

    parts.push(`role match: ${roles.join(", ")}`)

    if (request.privacyMode === "local_preferred") {
      const isLocal = provider.id === "ollama" || provider.id === "lmstudio"
      parts.push(isLocal ? "local provider (privacy mode)" : "cloud provider (no local available)")
    }

    return `Selected ${provider.name}: ${parts.join("; ")}`
  }

  private recordDecision(decision: RouteDecision): RouteDecision {
    this.traces.unshift(decision)
    if (this.traces.length > MAX_TRACE_ENTRIES) {
      this.traces = this.traces.slice(0, MAX_TRACE_ENTRIES)
    }
    return decision
  }

  /**
   * Validate that a route request has the required fields.
   * Logs and returns false if the request is malformed.
   */
  private validateRouteRequest(request: RouteRequest): boolean {
    const validTaskTypes = Object.keys(TASK_TO_ROLES)
    const validRiskLevels = ["low", "medium", "high"]

    if (!request.taskType || !validTaskTypes.includes(request.taskType)) {
      this.log.warn("Route validation failed: invalid or missing taskType", { taskType: request.taskType })
      return false
    }

    if (!request.riskLevel || !validRiskLevels.includes(request.riskLevel)) {
      this.log.warn("Route validation failed: invalid or missing riskLevel", { riskLevel: request.riskLevel })
      return false
    }

    return true
  }

  /** Reset retry budgets for all providers. Called hourly by the timer. */
  private resetRetryBudgets(): void {
    for (const provider of this.providers.values()) {
      provider.retriesUsed = 0
    }
  }

  private notifyListeners(): void {
    for (const cb of this.listeners) {
      try {
        cb()
      } catch {
        // Swallow listener errors to avoid breaking the service loop
      }
    }
  }
}
