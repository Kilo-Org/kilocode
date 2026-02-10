import type {
  ServerConfig,
  SessionInfo,
  MessageInfo,
  MessagePart,
  ProfileData,
  ProviderAuthAuthorization,
} from "./types"

/**
 * HTTP Client for communicating with the CLI backend server.
 * Handles all REST API calls for session management, messaging, and permissions.
 */
export class HttpClient {
  private readonly baseUrl: string
  private readonly authHeader: string
  private readonly authUsername = "opencode"

  constructor(config: ServerConfig) {
    this.baseUrl = config.baseUrl
    // Auth header format: Basic base64("opencode:password")
    // NOTE: The CLI server expects a non-empty username ("opencode"). Using an empty username
    // (":password") results in 401 for both REST and SSE endpoints.
    this.authHeader = `Basic ${Buffer.from(`${this.authUsername}:${config.password}`).toString("base64")}`

    // Safe debug logging: no secrets.
    console.log("[Kilo New] HTTP: 🔐 Auth configured", {
      username: this.authUsername,
      passwordLength: config.password.length,
    })
  }

  /**
   * Make an HTTP request to the CLI backend server.
   */
  private async request<T>(method: string, path: string, body?: unknown, options?: { directory?: string }): Promise<T> {
    const url = `${this.baseUrl}${path}`

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      "Content-Type": "application/json",
    }

    if (options?.directory) {
      headers["x-opencode-directory"] = options.directory
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      let errorMessage: string
      try {
        const errorJson = (await response.json()) as { error?: string; message?: string }
        errorMessage = errorJson.error || errorJson.message || response.statusText
      } catch {
        errorMessage = response.statusText
      }
      throw new Error(`HTTP ${response.status}: ${errorMessage}`)
    }

    return response.json() as Promise<T>
  }

  // ============================================
  // Session Management Methods
  // ============================================

  /**
   * Create a new session in the specified directory.
   */
  async createSession(directory: string): Promise<SessionInfo> {
    return this.request<SessionInfo>("POST", "/session", {}, { directory })
  }

  /**
   * Get information about an existing session.
   */
  async getSession(sessionId: string, directory: string): Promise<SessionInfo> {
    return this.request<SessionInfo>("GET", `/session/${sessionId}`, undefined, { directory })
  }

  /**
   * List all sessions in the specified directory.
   */
  async listSessions(directory: string): Promise<SessionInfo[]> {
    return this.request<SessionInfo[]>("GET", "/session", undefined, { directory })
  }

  // ============================================
  // Messaging Methods
  // ============================================

  /**
   * Send a message to a session.
   */
  async sendMessage(
    sessionId: string,
    parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }>,
    directory: string,
  ): Promise<{ info: MessageInfo; parts: MessagePart[] }> {
    return this.request<{ info: MessageInfo; parts: MessagePart[] }>(
      "POST",
      `/session/${sessionId}/message`,
      { parts },
      { directory },
    )
  }

  /**
   * Get all messages for a session.
   */
  async getMessages(sessionId: string, directory: string): Promise<Array<{ info: MessageInfo; parts: MessagePart[] }>> {
    return this.request<Array<{ info: MessageInfo; parts: MessagePart[] }>>(
      "GET",
      `/session/${sessionId}/message`,
      undefined,
      { directory },
    )
  }

  // ============================================
  // Control Methods
  // ============================================

  /**
   * Abort the current operation in a session.
   */
  async abortSession(sessionId: string, directory: string): Promise<boolean> {
    await this.request<void>("POST", `/session/${sessionId}/abort`, {}, { directory })
    return true
  }

  // ============================================
  // Permission Methods
  // ============================================

  /**
   * Respond to a permission request.
   */
  async respondToPermission(
    sessionId: string,
    permissionId: string,
    response: "once" | "always" | "reject",
    directory: string,
  ): Promise<boolean> {
    await this.request<void>("POST", `/session/${sessionId}/permissions/${permissionId}`, { response }, { directory })
    return true
  }

  // ============================================
  // Profile Methods
  // ============================================

  /**
   * Get the current user's profile from the kilo-gateway.
   * Returns null if not logged in or if the request fails.
   */
  async getProfile(): Promise<ProfileData | null> {
    try {
      return await this.request<ProfileData>("GET", "/kilo/profile")
    } catch {
      return null
    }
  }

  // ============================================
  // Auth Methods
  // ============================================

  /**
   * Remove authentication credentials for a provider.
   * Used for logout when called with "kilo".
   */
  async removeAuth(providerId: string): Promise<boolean> {
    return this.request<boolean>("DELETE", `/auth/${providerId}`)
  }

  /**
   * Initiate OAuth authorization for a provider.
   * Returns the authorization URL and instructions.
   */
  async oauthAuthorize(providerId: string, method: number, directory: string): Promise<ProviderAuthAuthorization> {
    return this.request<ProviderAuthAuthorization>(
      "POST",
      `/provider/${providerId}/oauth/authorize`,
      { method },
      { directory },
    )
  }

  /**
   * Complete OAuth callback for a provider.
   * For "auto" method providers (like kilo), this blocks until polling completes.
   */
  async oauthCallback(providerId: string, method: number, directory: string): Promise<boolean> {
    return this.request<boolean>("POST", `/provider/${providerId}/oauth/callback`, { method }, { directory })
  }
}
