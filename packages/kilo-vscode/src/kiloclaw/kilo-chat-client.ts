/**
 * HTTP client for the kilo-chat Cloudflare Worker.
 *
 * Minimal inline port of `@kilocode/kilo-chat/client` (cloud monorepo) tailored
 * to what the VS Code extension needs: conversation list + details, message
 * CRUD, reactions, typing, and action execution. No zod runtime validation —
 * the kilo-chat worker is the source of truth and validates at its edge.
 */

import type {
  BotStatusRecord,
  ContentBlock,
  ConversationDetail,
  ConversationListItem,
  ConversationStatusRecord,
  ExecApprovalDecision,
  Message,
} from "./types"

export type KiloChatClientConfig = {
  baseUrl: string
  getToken: () => Promise<string>
  onUnauthorized?: () => void
}

export class KiloChatApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`KiloChat request failed: ${status}${formatBodyDetail(body)}`)
    this.name = "KiloChatApiError"
  }
}

function formatBodyDetail(body: unknown): string {
  if (body === null || body === undefined) return ""
  if (typeof body === "string") return ` - ${body}`
  if (typeof body === "object") {
    const err = (body as Record<string, unknown>).error
    if (typeof err === "string") return ` - ${err}`
    // Fall back to a compact JSON dump so validation errors (zod issues, etc.)
    // show up in the extension's Output channel without a separate logging hop.
    try {
      return ` - ${JSON.stringify(body)}`
    } catch {
      return ""
    }
  }
  return ""
}

type HttpOpts = {
  method?: string
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
}

// Per-conversation send queues. sendMessage chains onto the tail of its
// conversation's queue so concurrent callers can't race ahead and get a lower
// server-assigned ULID than a later send.
type SendQueue = Map<string, Promise<unknown>>

export class KiloChatClient {
  private readonly baseUrl: string
  private readonly getToken: () => Promise<string>
  private readonly onUnauthorized: (() => void) | undefined
  private readonly sendQueues: SendQueue = new Map()

  constructor(config: KiloChatClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "")
    this.getToken = config.getToken
    this.onUnauthorized = config.onUnauthorized
  }

  // ── Conversations ────────────────────────────────────────────────

  listConversations(opts?: { sandboxId?: string; limit?: number; cursor?: string | null }): Promise<{
    conversations: ConversationListItem[]
    hasMore: boolean
    nextCursor: string | null
  }> {
    return this.request("/v1/conversations", {
      query: {
        sandboxId: opts?.sandboxId,
        limit: opts?.limit,
        cursor: opts?.cursor ?? undefined,
      },
    })
  }

  getConversation(conversationId: string): Promise<ConversationDetail> {
    return this.request(`/v1/conversations/${conversationId}`)
  }

  createConversation(req: {
    sandboxId: string
    title?: string
  }): Promise<{ conversationId: string; conversation?: ConversationDetail }> {
    return this.request("/v1/conversations", { method: "POST", body: req })
  }

  renameConversation(conversationId: string, title: string): Promise<{ ok: true }> {
    return this.request(`/v1/conversations/${conversationId}`, {
      method: "PATCH",
      body: { title },
    })
  }

  async leaveConversation(conversationId: string): Promise<void> {
    // Returns 200 JSON with `{ ok }`-style payload; we don't need the body.
    await this.request<unknown>(`/v1/conversations/${conversationId}/leave`, { method: "POST" })
  }

  /**
   * Mark messages up to `lastSeenMessageId` as read for the current user.
   * The server enforces monotonic `lastReadAt` and returns whether the read
   * pointer advanced plus whether the badge bucket was cleared.
   */
  markConversationRead(
    conversationId: string,
    req: { lastSeenMessageId: string },
  ): Promise<{ ok: boolean; applied: boolean; lastReadAt: number; badgeClear: boolean }> {
    return this.request(`/v1/conversations/${conversationId}/mark-read`, {
      method: "POST",
      body: req,
    })
  }

  // ── Messages ─────────────────────────────────────────────────────

  sendMessage(req: {
    conversationId: string
    content: ContentBlock[]
    inReplyToMessageId?: string
    clientId?: string
  }): Promise<{ messageId: string; clientId?: string; message?: Message }> {
    const prev = this.sendQueues.get(req.conversationId) ?? Promise.resolve()
    const send = () =>
      this.request<{ messageId: string; clientId?: string; message?: Message }>("/v1/messages", {
        method: "POST",
        body: req,
      })
    const next = prev.then(send, send)
    this.sendQueues.set(req.conversationId, next)
    const cleanup = () => {
      if (this.sendQueues.get(req.conversationId) === next) {
        this.sendQueues.delete(req.conversationId)
      }
    }
    void next.then(cleanup, cleanup)
    return next
  }

  editMessage(
    messageId: string,
    req: { conversationId: string; content: ContentBlock[]; timestamp: number },
  ): Promise<{ messageId?: string; message?: Message }> {
    return this.request(`/v1/messages/${messageId}`, { method: "PATCH", body: req })
  }

  async deleteMessage(messageId: string, conversationId: string): Promise<void> {
    // Returns 200 JSON with `{ ok }`-style payload; we don't need the body.
    await this.request<unknown>(`/v1/messages/${messageId}`, {
      method: "DELETE",
      query: { conversationId },
    })
  }

  listMessages(
    conversationId: string,
    opts?: { before?: string; limit?: number },
  ): Promise<{ messages: Message[]; hasMore: boolean; nextCursor: string | null }> {
    return this.request(`/v1/conversations/${conversationId}/messages`, {
      query: { before: opts?.before, limit: opts?.limit },
    })
  }

  executeAction(
    conversationId: string,
    messageId: string,
    req: { groupId: string; value: ExecApprovalDecision },
  ): Promise<{ ok?: boolean; message?: Message; content?: ContentBlock[] }> {
    return this.request(`/v1/conversations/${conversationId}/messages/${messageId}/execute-action`, {
      method: "POST",
      body: req,
    })
  }

  // ── Reactions ────────────────────────────────────────────────────

  addReaction(
    messageId: string,
    req: { conversationId: string; emoji: string },
  ): Promise<{ id: string; operationId?: string }> {
    return this.request(`/v1/messages/${messageId}/reactions`, { method: "POST", body: req })
  }

  async removeReaction(
    messageId: string,
    req: { conversationId: string; emoji: string },
  ): Promise<{ removed: boolean; id: string | null; operationId?: string }> {
    return this.request<{ removed: boolean; id: string | null; operationId?: string }>(
      `/v1/messages/${messageId}/reactions`,
      {
        method: "DELETE",
        query: req,
      },
    )
  }

  // ── Typing ───────────────────────────────────────────────────────

  async sendTyping(conversationId: string): Promise<void> {
    await this.request<unknown>(`/v1/conversations/${conversationId}/typing`, { method: "POST" })
  }

  async sendTypingStop(conversationId: string): Promise<void> {
    await this.request<unknown>(`/v1/conversations/${conversationId}/typing/stop`, { method: "POST" })
  }

  // ── Bot / conversation status ────────────────────────────────────

  getBotStatus(sandboxId: string): Promise<{ status: BotStatusRecord | null }> {
    return this.request(`/v1/sandboxes/${sandboxId}/bot-status`)
  }

  async requestBotStatus(sandboxId: string): Promise<void> {
    await this.request<unknown>(`/v1/sandboxes/${sandboxId}/request-bot-status`, { method: "POST" })
  }

  getConversationStatus(conversationId: string): Promise<{ status: ConversationStatusRecord | null }> {
    return this.request(`/v1/conversations/${conversationId}/conversation-status`)
  }

  // ── private ──────────────────────────────────────────────────────

  private async request<T>(path: string, opts: HttpOpts = {}): Promise<T> {
    const token = await this.getToken()
    let url = `${this.baseUrl}${path}`

    if (opts.query) {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined || v === null) continue
        params.set(k, String(v))
      }
      const qs = params.toString()
      if (qs) url += `?${qs}`
    }

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
    if (opts.body !== undefined) headers["Content-Type"] = "application/json"

    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) this.onUnauthorized?.()
      const body: unknown = await res.json().catch(() => null)
      throw new KiloChatApiError(res.status, body)
    }

    if (res.status === 204) return undefined as unknown as T
    return (await res.json()) as T
  }
}
