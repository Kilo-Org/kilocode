import type { ServerConfig, SessionInfo, MessageInfo, MessagePart } from "./types"

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
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { directory?: string }
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`

    const bodySummary = (() => {
      if (body === undefined) {
        return { hasBody: false }
      }

      if (typeof body !== "object" || body === null) {
        return { hasBody: true, kind: typeof body }
      }

      const record = body as Record<string, unknown>
      const parts = record["parts"]
      if (Array.isArray(parts)) {
        return {
          hasBody: true,
          kind: "object",
          keys: Object.keys(record),
          parts: parts.map((p) => {
            if (typeof p !== "object" || p === null) {
              return { kind: typeof p }
            }
            const part = p as Record<string, unknown>
            const type = typeof part["type"] === "string" ? (part["type"] as string) : "(missing)"
            const text = typeof part["text"] === "string" ? (part["text"] as string) : null
            return {
              type,
              keys: Object.keys(part),
              textLength: text ? text.length : undefined,
            }
          }),
        }
      }

      return { hasBody: true, kind: "object", keys: Object.keys(record) }
    })()

    console.log("[Kilo New] HTTP: ➡️ Request", {
      method,
      path,
      directory: options?.directory,
      body: bodySummary,
    })

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

    console.log("[Kilo New] HTTP: ⬅️ Response", {
      method,
      path,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
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

    // Handle empty responses (204 No Content or empty body with 200)
    const contentLength = response.headers.get("content-length")
    if (response.status === 204 || contentLength === "0") {
      console.log("[Kilo New] HTTP: ℹ️ Empty response body, returning undefined")
      return undefined as T
    }

    const responseForDebug = response.clone()
    try {
      const text = await response.text()
      // Handle truly empty responses even when content-length header is missing
      if (!text || text.trim() === "") {
        console.log("[Kilo New] HTTP: ℹ️ Empty response text, returning undefined")
        return undefined as T
      }
      return JSON.parse(text) as T
    } catch (error) {
      let raw = ""
      try {
        raw = await responseForDebug.text()
      } catch {
        // ignore
      }

      console.error("[Kilo New] HTTP: ❌ Failed to parse JSON response", {
        method,
        path,
        status: response.status,
        contentType: response.headers.get("content-type"),
        rawLength: raw.length,
        rawSnippet: raw.slice(0, 500),
      })
      throw error
    }
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
   * Note: The backend may return an empty response (200 with no body).
   * The actual message data is streamed via SSE events.
   */
  async sendMessage(
    sessionId: string,
    parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }>,
    directory: string
  ): Promise<{ info: MessageInfo; parts: MessagePart[] } | void> {
    return this.request<{ info: MessageInfo; parts: MessagePart[] } | void>(
      "POST",
      `/session/${sessionId}/message`,
      { parts },
      { directory }
    )
  }

  /**
   * Get all messages for a session.
   */
  async getMessages(
    sessionId: string,
    directory: string
  ): Promise<Array<{ info: MessageInfo; parts: MessagePart[] }>> {
    return this.request<Array<{ info: MessageInfo; parts: MessagePart[] }>>(
      "GET",
      `/session/${sessionId}/message`,
      undefined,
      { directory }
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
    directory: string
  ): Promise<boolean> {
    await this.request<void>(
      "POST",
      `/session/${sessionId}/permissions/${permissionId}`,
      { response },
      { directory }
    )
    return true
  }
}
