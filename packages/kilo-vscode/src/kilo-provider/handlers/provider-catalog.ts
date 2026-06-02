import type { KiloClient } from "@kilocode/sdk/v2/client"
import { indexProvidersById } from "../../kilo-provider-utils"
import {
  authorizeProviderOAuth,
  buildActionContext,
  completeProviderOAuth,
  computeDefaultSelection,
  connectProvider,
  disconnectProvider,
  fetchProviderData,
  saveCustomProvider,
  validateFavorites,
  validateRecents,
} from "../../provider-actions"
import { fetchOpenAIModels, FetchModelsError } from "../../shared/fetch-models"

type Selection = { providerID: string; modelID: string }
type StateKey = "recentModels" | "favoriteModels"

interface ProviderCatalogContext {
  getClient(): KiloClient | null
  getWorkspaceDirectory(): string
  getCachedConfigMessage(): unknown
  setCachedConfigMessage(msg: unknown): void
  getModelSettings(): Selection
  getState(key: StateKey): unknown
  updateState(key: StateKey, value: unknown): Promise<void>
  notifyFavoritesChanged(favorites: Selection[]): void
  postMessage(msg: unknown): void
  getErrorMessage(err: unknown): string
}

export class ProviderCatalog {
  private cached: unknown = null
  private task: Promise<void> | null = null
  private queued = false
  private generation = 0

  constructor(private readonly ctx: ProviderCatalogContext) {}

  /** Fetch providers and send to webview. Coalesced: at most one in-flight + one queued. */
  async refresh(): Promise<void> {
    const next = ++this.generation
    if (this.task) {
      this.queued = true
      await this.task
      return
    }
    const task = (async () => {
      let generation = next
      while (true) {
        this.queued = false
        const client = this.ctx.getClient()
        if (!client) {
          if (this.cached && generation === this.generation) this.ctx.postMessage(this.cached)
          return
        }
        try {
          const { response, authMethods, authStates } = await fetchProviderData(
            client,
            this.ctx.getWorkspaceDirectory(),
          )
          if (generation !== this.generation || client !== this.ctx.getClient()) {
            if (!this.queued) return
            generation = this.generation
            continue
          }
          const settings = this.ctx.getModelSettings()
          const message = {
            type: "providersLoaded",
            providers: indexProvidersById(response.all),
            connected: response.connected,
            defaults: response.default,
            defaultSelection: computeDefaultSelection(
              this.ctx.getCachedConfigMessage() as { config?: { model?: string } } | null,
              settings.providerID,
              settings.modelID,
            ),
            authMethods,
            authStates,
          }
          this.cached = message
          this.ctx.postMessage(message)
        } catch (error) {
          if (generation !== this.generation) {
            if (!this.queued) return
            generation = this.generation
            continue
          }
          console.error("[Kilo New] KiloProvider: Failed to fetch providers:", error)
        }
        if (!this.queued) return
        generation = this.generation
      }
    })()
    const done = task.finally(() => {
      if (this.task === done) this.task = null
    })
    this.task = done
    await done
  }

  async handleMessage(msg: Record<string, unknown>): Promise<boolean> {
    switch (msg.type) {
      case "requestProviders":
        this.refresh().catch((error) => console.error("[Kilo New] fetchAndSendProviders failed:", error))
        return true
      case "connectProvider":
      case "authorizeProviderOAuth":
      case "completeProviderOAuth":
      case "disconnectProvider":
      case "saveCustomProvider":
        await this.handleAction(msg)
        return true
      case "fetchCustomProviderModels":
        this.fetchModels(msg).catch((error) => console.error("[Kilo New] fetchCustomProviderModels failed:", error))
        return true
      case "persistRecents":
        await this.ctx.updateState("recentModels", validateRecents(msg.recents))
        return true
      case "requestRecents":
        this.ctx.postMessage({ type: "recentsLoaded", recents: validateRecents(this.ctx.getState("recentModels")) })
        return true
      case "toggleFavorite": {
        if (typeof msg.providerID !== "string" || typeof msg.modelID !== "string") return true
        const current = validateFavorites(this.ctx.getState("favoriteModels"))
        const key = `${msg.providerID}/${msg.modelID}`
        const exists = current.some((favorite) => `${favorite.providerID}/${favorite.modelID}` === key)
        const favorites =
          msg.action === "add" && !exists
            ? [...current, { providerID: msg.providerID, modelID: msg.modelID }]
            : msg.action === "remove" && exists
              ? current.filter((favorite) => `${favorite.providerID}/${favorite.modelID}` !== key)
              : current
        await this.ctx.updateState("favoriteModels", favorites)
        this.ctx.notifyFavoritesChanged(favorites)
        return true
      }
      case "requestFavorites":
        this.sendFavorites(validateFavorites(this.ctx.getState("favoriteModels")))
        return true
      default:
        return false
    }
  }

  sendFavorites(favorites: Selection[]): void {
    this.ctx.postMessage({ type: "favoritesLoaded", favorites })
  }

  private async handleAction(msg: Record<string, unknown>): Promise<void> {
    const rid = typeof msg.requestId === "string" ? msg.requestId : ""
    const pid = typeof msg.providerID === "string" ? msg.providerID : ""
    if (!rid || !pid) return
    const client = this.ctx.getClient()
    if (!client) {
      const action =
        msg.type === "disconnectProvider"
          ? "disconnect"
          : msg.type === "authorizeProviderOAuth"
            ? "authorize"
            : "connect"
      this.ctx.postMessage({
        type: "providerActionError",
        requestId: rid,
        providerID: pid,
        action,
        message: "Not connected to CLI backend",
      })
      return
    }
    const ctx = buildActionContext(
      client,
      (message) => this.ctx.postMessage(message),
      this.ctx.getErrorMessage,
      this.ctx.getWorkspaceDirectory(),
      () => this.refresh(),
    )
    await this.runAction(ctx, msg, rid, pid)
  }

  private async runAction(
    ctx: ReturnType<typeof buildActionContext>,
    msg: Record<string, unknown>,
    rid: string,
    pid: string,
  ): Promise<void> {
    const method = typeof msg.method === "number" ? msg.method : 0
    const key = typeof msg.apiKey === "string" ? msg.apiKey : undefined
    const changed = msg.apiKeyChanged === true
    const code = typeof msg.code === "string" ? msg.code : undefined
    const config = msg.config && typeof msg.config === "object" ? (msg.config as Record<string, unknown>) : undefined
    const metadata =
      msg.metadata && typeof msg.metadata === "object" ? (msg.metadata as Record<string, unknown>) : undefined
    if (msg.type === "connectProvider" && key) return connectProvider(ctx, rid, pid, key, metadata)
    if (msg.type === "authorizeProviderOAuth") return authorizeProviderOAuth(ctx, rid, pid, method)
    if (msg.type === "completeProviderOAuth") return completeProviderOAuth(ctx, rid, pid, method, code)
    if (msg.type === "disconnectProvider")
      return disconnectProvider(ctx, rid, pid, this.ctx.getCachedConfigMessage(), (message) =>
        this.ctx.setCachedConfigMessage(message),
      )
    if (msg.type === "saveCustomProvider" && config)
      return saveCustomProvider(ctx, rid, pid, config, key, changed, this.ctx.getCachedConfigMessage(), (message) =>
        this.ctx.setCachedConfigMessage(message),
      )
  }

  private async fetchModels(msg: Record<string, unknown>): Promise<void> {
    const rid = typeof msg.requestId === "string" ? msg.requestId : ""
    const url = typeof msg.baseURL === "string" ? msg.baseURL : ""
    if (!rid || !url) return
    const key = typeof msg.apiKey === "string" ? msg.apiKey : undefined
    const headers = msg.headers && typeof msg.headers === "object" ? (msg.headers as Record<string, string>) : undefined
    try {
      const models = await fetchOpenAIModels({ baseURL: url, apiKey: key, headers })
      this.ctx.postMessage({ type: "customProviderModelsFetched", requestId: rid, models })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch models"
      const auth = err instanceof FetchModelsError && err.auth
      this.ctx.postMessage({ type: "customProviderModelsFetched", requestId: rid, error: message, auth })
    }
  }
}
