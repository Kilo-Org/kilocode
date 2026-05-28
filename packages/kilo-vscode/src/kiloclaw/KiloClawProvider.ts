/**
 * KiloClaw panel provider for the VS Code extension.
 *
 * Owns the Kilo Chat HTTP client + event-service WebSocket connection
 * (in the extension host Node.js runtime) and relays messages to/from
 * the webview via postMessage.
 *
 * Architecture: extension host owns both clients and reactive state;
 * the webview is a stateless renderer that issues commands via
 * postMessage and receives state diffs back.
 */

import * as vscode from "vscode"
import { homedir } from "os"
import type { KiloConnectionService } from "../services/cli-backend"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { buildWebviewHtml } from "../utils"
import { watchFontSizeConfig } from "../kilo-provider/font-size"
import { TokenManager } from "./token-manager"
import { KiloChatApiError, KiloChatClient } from "./kilo-chat-client"
import { EventServiceClient, WebSocketAuthError } from "./event-service-client"
import { ulid } from "./ulid"
import type {
  ActionDeliveryFailedEvent,
  BotStatusEvent,
  BotStatusRecord,
  ChatToken,
  ClawStatus,
  ContentBlock,
  ConversationActivityEvent,
  ConversationCreatedEvent,
  ConversationLeftEvent,
  ConversationListItem,
  ConversationRenamedEvent,
  ConversationStatusEvent,
  ConversationStatusRecord,
  ExecApprovalDecision,
  KiloClawInMessage,
  KiloClawOutMessage,
  KiloClawState,
  Message,
  MessageCreatedEvent,
  MessageDeletedEvent,
  MessageDeliveryFailedEvent,
  MessageUpdatedEvent,
  ReactionAddedEvent,
  ReactionRemovedEvent,
  TypingMember,
  TypingEvent,
} from "./types"

const STATUS_POLL_MS = 10_000
const BOT_STATUS_NUDGE_MS = 15_000
const TYPING_TIMEOUT_MS = 5_000
const MESSAGES_PAGE = 50
const CONVERSATIONS_PAGE = 50

export class KiloClawProvider implements vscode.Disposable {
  static readonly viewType = "kilo-code.new.KiloClawPanel"

  private panel: vscode.WebviewPanel | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private botNudge: ReturnType<typeof setInterval> | null = null
  private subs: Array<() => void> = []
  private chatSubs: Array<() => void> = []
  private disposed = false
  private initializing = false
  private generation = 0

  // Clients (created lazily per init)
  private events: EventServiceClient | null = null
  private chat: KiloChatClient | null = null
  private tokens: TokenManager | null = null

  // Reactive state mirrored to the webview
  private status: ClawStatus | null = null
  private currentUserId: string | null = null
  private sandboxId: string | null = null
  private conversations: ConversationListItem[] = []
  private conversationsCursor: string | null = null
  private hasMoreConversations = false
  private activeConversationId: string | null = null
  private messages: Message[] = []
  private hasMoreMessages = false
  private botStatus: BotStatusRecord | null = null
  private conversationStatus: ConversationStatusRecord | null = null
  private typingMembers: TypingMember[] = []
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private subscribedSandboxContext: string | null = null
  private subscribedConversationContext: string | null = null

  constructor(
    private readonly uri: vscode.Uri,
    private readonly connection: KiloConnectionService,
  ) {}

  openPanel(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One)
      return
    }

    const panel = vscode.window.createWebviewPanel(KiloClawProvider.viewType, "KiloClaw", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.uri],
    })

    this.attach(panel)
  }

  /** Restore a serialized panel after VS Code restart. */
  restorePanel(panel: vscode.WebviewPanel): void {
    this.attach(panel)
  }

  dispose(): void {
    this.disposed = true
    this.cleanup()
    this.panel?.dispose()
    this.panel = null
  }

  // --- private ---

  private attach(panel: vscode.WebviewPanel): void {
    if (this.panel) {
      this.cleanup()
      this.panel.dispose()
    }
    this.panel = panel

    panel.iconPath = {
      light: vscode.Uri.joinPath(this.uri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.uri, "assets", "icons", "kilo-dark.svg"),
    }

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.uri],
    }

    panel.webview.html = buildWebviewHtml(panel.webview, {
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.uri, "dist", "kiloclaw.js")),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.uri, "dist", "kiloclaw.css")),
      iconsBaseUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.uri, "assets", "icons")),
      title: "KiloClaw",
    })

    const msgSub = panel.webview.onDidReceiveMessage((msg: KiloClawInMessage) => this.onMessage(msg))
    this.subs.push(() => msgSub.dispose())
    const disposeSub = panel.onDidDispose(() => {
      this.panel = null
      this.cleanup()
    })
    this.subs.push(() => disposeSub.dispose())

    // Pause status polling + bot nudge when the panel is not visible
    const viewSub = panel.onDidChangeViewState(() => {
      if (panel.visible) {
        this.startPolling()
        this.startBotNudge()
      } else {
        this.stopPolling()
        this.stopBotNudge()
      }
    })
    this.subs.push(() => viewSub.dispose())

    const unsub = this.connection.onLanguageChanged((locale) => {
      this.post({ type: "kiloclaw.locale", locale })
    })
    this.subs.push(unsub)
    const font = watchFontSizeConfig((msg) => this.post(msg))
    this.subs.push(() => font.dispose())
  }

  private post(msg: KiloClawOutMessage): void {
    this.panel?.webview.postMessage(msg)
  }

  private async onMessage(msg: KiloClawInMessage): Promise<void> {
    switch (msg.type) {
      case "kiloclaw.ready":
        await this.init()
        return
      case "kiloclaw.openExternal": {
        const uri = vscode.Uri.parse(msg.url)
        if (uri.scheme === "https" || uri.scheme === "http") {
          void vscode.env.openExternal(uri)
        }
        return
      }
      case "kiloclaw.selectConversation":
        await this.selectConversation(msg.conversationId)
        return
      case "kiloclaw.createConversation":
        await this.createConversation(msg.title)
        return
      case "kiloclaw.renameConversation":
        await this.renameConversation(msg.conversationId, msg.title)
        return
      case "kiloclaw.leaveConversation":
        await this.leaveConversation(msg.conversationId)
        return
      case "kiloclaw.loadMoreConversations":
        await this.loadMoreConversations()
        return
      case "kiloclaw.sendMessage":
        await this.sendMessage(msg.conversationId, msg.content, msg.inReplyToMessageId)
        return
      case "kiloclaw.editMessage":
        await this.editMessage(msg.conversationId, msg.messageId, msg.content)
        return
      case "kiloclaw.deleteMessage":
        await this.deleteMessage(msg.conversationId, msg.messageId)
        return
      case "kiloclaw.loadMoreMessages":
        await this.loadMoreMessages(msg.conversationId, msg.before)
        return
      case "kiloclaw.addReaction":
        await this.addReaction(msg.conversationId, msg.messageId, msg.emoji)
        return
      case "kiloclaw.removeReaction":
        await this.removeReaction(msg.conversationId, msg.messageId, msg.emoji)
        return
      case "kiloclaw.executeAction":
        await this.executeAction(msg.conversationId, msg.messageId, msg.groupId, msg.value)
        return
      case "kiloclaw.sendTyping":
        await this.sendTyping(msg.conversationId)
        return
      case "kiloclaw.sendTypingStop":
        await this.sendTypingStop(msg.conversationId)
        return
      case "kiloclaw.markRead":
        await this.markRead(msg.conversationId)
        return
    }
  }

  private get locale(): string {
    const override = vscode.workspace.getConfiguration("kilo-code.new").get<string>("language")
    return override || vscode.env.language
  }

  private stale(gen: number): boolean {
    return gen !== this.generation || this.disposed
  }

  // ── init / lifecycle ────────────────────────────────────────────────

  private async init(): Promise<void> {
    if (this.initializing || this.disposed) return
    this.initializing = true
    const gen = this.generation

    let deferred = false

    try {
      this.post({ type: "kiloclaw.state", state: { phase: "loading", locale: this.locale } })

      const client = await this.resolveClient()
      if (this.stale(gen)) return
      if (!client) {
        deferred = true
        this.waitForConnection()
        return
      }

      const ok = await this.bootstrap(client, gen)
      if (!ok) return
      if (this.stale(gen)) return

      const state: KiloClawState = {
        phase: "ready",
        locale: this.locale,
        status: this.status,
        currentUserId: this.currentUserId ?? "",
        sandboxId: this.sandboxId ?? "",
        conversations: this.conversations,
        hasMoreConversations: this.hasMoreConversations,
        activeConversationId: this.activeConversationId,
        messages: this.messages,
        hasMoreMessages: this.hasMoreMessages,
        botStatus: this.botStatus,
        conversationStatus: this.conversationStatus,
        typingMembers: this.typingMembers,
      }
      this.post({ type: "kiloclaw.state", state })
      this.startPolling()
      this.startBotNudge()
    } finally {
      if (!deferred) this.initializing = false
    }
  }

  /**
   * Resolve instance status, fetch chat token, and wire up all clients.
   * Returns `true` if everything is ready, `false` if a non-ready phase
   * was already posted (loading / noInstance / needsUpgrade / error).
   */
  private async bootstrap(client: KiloClient, gen: number): Promise<boolean> {
    const ok = await this.resolveStatus(client, gen)
    if (!ok) return false
    if (this.stale(gen)) return false

    const envelope = await this.fetchChatToken(gen)
    if (!envelope) return false
    if (this.stale(gen)) return false

    if (!(await this.openChatStream(envelope, gen))) return false
    if (this.stale(gen)) return false

    if (!this.sandboxId) {
      this.post({ type: "kiloclaw.state", state: { phase: "noInstance", locale: this.locale } })
      return false
    }

    await this.loadInitialSnapshots()
    return true
  }

  private async resolveStatus(client: KiloClient, gen: number): Promise<boolean> {
    const statusRes = await client.kilo.claw.status().catch(() => null)
    if (this.stale(gen)) return false

    const statusData = statusRes?.data as (ClawStatus & { userId?: string }) | undefined
    if (!statusRes || (statusRes as Record<string, unknown>).error || !statusData || !statusData.userId) {
      this.post({ type: "kiloclaw.state", state: { phase: "noInstance", locale: this.locale } })
      return false
    }
    this.status = statusData
    this.currentUserId = statusData.userId
    this.sandboxId = statusData.sandboxId ?? null
    return true
  }

  private async fetchChatToken(gen: number): Promise<ChatToken | null> {
    const tokens = new TokenManager(() => {
      try {
        return this.connection.getClient()
      } catch {
        return null
      }
    })
    try {
      const envelope = await tokens.getOrFetch()
      this.tokens = tokens
      return envelope
    } catch (err) {
      if (this.stale(gen)) return null
      const message = err instanceof Error ? err.message : String(err)
      console.error("[Kilo New] KiloClaw chat token fetch failed:", message)
      // Token fetch typically fails when the instance hasn't been upgraded
      // to support kilo-chat — surface that as the upgrade prompt.
      this.post({ type: "kiloclaw.state", state: { phase: "needsUpgrade", locale: this.locale } })
      return null
    }
  }

  private async openChatStream(envelope: ChatToken, gen: number): Promise<boolean> {
    const tokens = this.tokens!
    const events = new EventServiceClient({
      url: envelope.eventServiceUrl,
      getToken: () => tokens.get(),
      onUnauthorized: () => {
        tokens.clear()
        this.post({ type: "kiloclaw.error", error: "Authentication expired" })
      },
    })
    this.events = events

    const chat = new KiloChatClient({
      baseUrl: envelope.kiloChatUrl,
      getToken: () => tokens.get(),
      onUnauthorized: () => {
        tokens.clear()
        this.post({ type: "kiloclaw.error", error: "Authentication expired" })
      },
    })
    this.chat = chat

    try {
      await events.connect()
    } catch (err) {
      if (this.stale(gen)) return false
      if (err instanceof WebSocketAuthError) {
        this.post({ type: "kiloclaw.state", state: { phase: "needsUpgrade", locale: this.locale } })
        return false
      }
      const message = err instanceof Error ? err.message : String(err)
      console.error("[Kilo New] KiloClaw event-service connect failed:", message)
      this.post({
        type: "kiloclaw.state",
        state: { phase: "error", locale: this.locale, error: message || "Failed to connect to chat" },
      })
      return false
    }

    this.attachEventHandlers(events, chat)
    this.subscribeSandboxContext()
    return true
  }

  private async loadInitialSnapshots(): Promise<void> {
    if (!this.chat) return
    const target = this.sandboxId
    if (!target) return

    try {
      const list = await this.chat.listConversations({ sandboxId: target, limit: CONVERSATIONS_PAGE })
      if (this.sandboxId !== target) return
      this.conversations = list.conversations
      this.conversationsCursor = list.nextCursor
      this.hasMoreConversations = list.hasMore
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn("[Kilo New] KiloClaw listConversations failed:", message)
    }

    try {
      const res = await this.chat.getBotStatus(target)
      if (this.sandboxId !== target) return
      this.botStatus = res.status ?? null
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn("[Kilo New] KiloClaw getBotStatus failed:", message)
    }

    // Auto-select the most recent conversation so the panel opens straight
    // into the user's ongoing chat instead of the "select a conversation"
    // empty state. Only runs on first init (or after the active one was
    // explicitly cleared) — preserves the user's selection across reconnects.
    if (!this.activeConversationId && this.conversations.length > 0) {
      const latest = this.conversations.reduce((best, c) => {
        const ax = best.lastActivityAt ?? best.joinedAt
        const bx = c.lastActivityAt ?? c.joinedAt
        return bx > ax ? c : best
      })
      this.activeConversationId = latest.conversationId
      this.subscribeConversationContext(latest.conversationId)
      await this.refreshActiveMessages()

      try {
        const res = await this.chat.getConversationStatus(latest.conversationId)
        if (this.activeConversationId === latest.conversationId) {
          this.conversationStatus = res.status ?? null
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn("[Kilo New] KiloClaw getConversationStatus failed:", message)
      }

      void this.markRead(latest.conversationId)
    }
  }

  private async resolveClient(): Promise<KiloClient | null> {
    if (this.connection.getConnectionState() !== "connected") {
      try {
        const dir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir()
        await this.connection.connect(dir)
      } catch (err) {
        console.debug("[Kilo New] KiloClaw connect deferred:", (err as Error)?.message ?? err)
        return null
      }
    }
    try {
      return this.connection.getClient()
    } catch (err) {
      console.debug("[Kilo New] KiloClaw getClient deferred:", (err as Error)?.message ?? err)
      return null
    }
  }

  private waitForConnection(): void {
    const unsub = this.connection.onStateChange((state) => {
      if (state === "connected" && !this.disposed) {
        unsub()
        this.initializing = false
        void this.init()
      }
    })
    this.subs.push(unsub)
  }

  // ── Subscriptions ───────────────────────────────────────────────────

  private subscribeSandboxContext(): void {
    if (!this.events || !this.sandboxId) return
    const ctx = `/kiloclaw/${this.sandboxId}`
    this.events.subscribe([ctx])
    this.subscribedSandboxContext = ctx
  }

  private subscribeConversationContext(conversationId: string): void {
    if (!this.events || !this.sandboxId) return
    if (this.subscribedConversationContext) {
      this.events.unsubscribe([this.subscribedConversationContext])
    }
    const ctx = `/kiloclaw/${this.sandboxId}/${conversationId}`
    this.events.subscribe([ctx])
    this.subscribedConversationContext = ctx
  }

  private unsubscribeConversationContext(): void {
    if (!this.events || !this.subscribedConversationContext) return
    this.events.unsubscribe([this.subscribedConversationContext])
    this.subscribedConversationContext = null
  }

  private attachEventHandlers(events: EventServiceClient, _chat: KiloChatClient): void {
    // Reset on reconnect — the event stream may have missed events while
    // disconnected, so refetch authoritative state.
    const offReconnect = events.onReconnect(() => {
      void this.refreshOnReconnect()
    })
    this.chatSubs.push(offReconnect)

    // ── Sandbox-scoped events ─────────────────────────────────────────

    this.chatSubs.push(
      events.on("conversation.created", (ctx, e: ConversationCreatedEvent) => {
        if (!this.sandboxId || ctx !== `/kiloclaw/${this.sandboxId}`) return
        // Newer servers include the full conversation snapshot — splice it in
        // immediately so the list updates without a roundtrip. Fall back to a
        // refetch when the snapshot is absent (older servers / safety net).
        if (e.conversation) {
          this.conversations = mergeConversations([e.conversation], this.conversations)
          this.broadcastConversations({ replace: true })
          return
        }
        void this.refreshConversations()
      }),
    )

    this.chatSubs.push(
      events.on("conversation.renamed", (ctx, e: ConversationRenamedEvent) => {
        if (!this.sandboxId || ctx !== `/kiloclaw/${this.sandboxId}`) return
        this.conversations = this.conversations.map((c) =>
          c.conversationId === e.conversationId ? { ...c, title: e.title } : c,
        )
        this.broadcastConversations({ replace: true })
      }),
    )

    this.chatSubs.push(
      events.on("conversation.left", (ctx, e: ConversationLeftEvent) => {
        if (!this.sandboxId || ctx !== `/kiloclaw/${this.sandboxId}`) return
        this.conversations = this.conversations.filter((c) => c.conversationId !== e.conversationId)
        if (this.activeConversationId === e.conversationId) {
          this.activeConversationId = null
          this.unsubscribeConversationContext()
          this.messages = []
          this.hasMoreMessages = false
          this.conversationStatus = null
          this.post({ type: "kiloclaw.activeConversation", conversationId: null })
          this.post({
            type: "kiloclaw.messages",
            conversationId: e.conversationId,
            messages: [],
            hasMore: false,
            replace: true,
          })
          this.post({ type: "kiloclaw.conversationStatus", status: null })
        }
        this.broadcastConversations({ replace: true })
      }),
    )

    this.chatSubs.push(
      events.on("conversation.activity", (ctx, e: ConversationActivityEvent) => {
        if (!this.sandboxId || ctx !== `/kiloclaw/${this.sandboxId}`) return
        this.conversations = this.conversations.map((c) =>
          c.conversationId === e.conversationId ? { ...c, lastActivityAt: e.lastActivityAt } : c,
        )
        this.broadcastConversations({ replace: true })
      }),
    )

    this.chatSubs.push(
      events.on("bot.status", (ctx, e: BotStatusEvent) => {
        if (!this.sandboxId || ctx !== `/kiloclaw/${this.sandboxId}`) return
        if (e.sandboxId !== this.sandboxId) return
        this.botStatus = { online: e.online, at: e.at, updatedAt: Date.now() }
        this.post({ type: "kiloclaw.botStatus", status: this.botStatus })
      }),
    )

    // ── Conversation-scoped events ────────────────────────────────────

    this.chatSubs.push(
      events.on("message.created", (ctx, e: MessageCreatedEvent) => {
        if (ctx !== this.subscribedConversationContext) return
        // Skip if already in cache (race with HTTP response)
        if (this.messages.some((m) => m.id === e.messageId)) return
        const server = this.toMessageFromCreated(e)
        // Reconcile optimistic message via clientId — send the full server
        // message so the webview replaces content, not just the id. Without
        // this, the webview would display stale client-side content under
        // the new id until the next full broadcast.
        if (e.clientId) {
          const pending = `pending-${e.clientId}`
          const idx = this.messages.findIndex((m) => m.id === pending)
          if (idx !== -1) {
            this.messages = this.messages.map((m, i) => (i === idx ? server : m))
            this.post({
              type: "kiloclaw.messageReplaced",
              conversationId: this.activeConversationId ?? "",
              pendingId: pending,
              message: server,
            })
            return
          }
        }
        this.messages = [...this.messages, server]
        this.broadcastMessages({ replace: true })
      }),
    )

    this.chatSubs.push(
      events.on("message.updated", (ctx, e: MessageUpdatedEvent) => {
        if (ctx !== this.subscribedConversationContext) return
        const idx = this.messages.findIndex((m) => m.id === e.messageId)
        if (idx === -1) return
        this.messages = this.messages.map((m, i) =>
          i === idx ? { ...m, content: e.content, clientUpdatedAt: e.clientUpdatedAt } : m,
        )
        this.broadcastMessages({ replace: true })
      }),
    )

    this.chatSubs.push(
      events.on("message.deleted", (ctx, e: MessageDeletedEvent) => {
        if (ctx !== this.subscribedConversationContext) return
        this.messages = this.messages.map((m) => (m.id === e.messageId ? { ...m, deleted: true } : m))
        this.broadcastMessages({ replace: true })
      }),
    )

    this.chatSubs.push(
      events.on("message.delivery_failed", (ctx, e: MessageDeliveryFailedEvent) => {
        if (ctx !== this.subscribedConversationContext) return
        this.messages = this.messages.map((m) => (m.id === e.messageId ? { ...m, deliveryFailed: true } : m))
        this.broadcastMessages({ replace: true })
      }),
    )

    this.chatSubs.push(
      events.on("action.delivery_failed", (ctx, e: ActionDeliveryFailedEvent) => {
        if (ctx !== this.subscribedConversationContext) return
        this.messages = this.messages.map((m) => {
          if (m.id !== e.messageId) return m
          return {
            ...m,
            content: m.content.map((b) => {
              if (b.type !== "actions") return b
              if (b.groupId !== e.groupId) return b
              return { ...b, resolved: undefined }
            }),
          }
        })
        this.broadcastMessages({ replace: true })
        this.post({ type: "kiloclaw.error", error: "Couldn't reach the bot — please try again" })
      }),
    )

    this.chatSubs.push(
      events.on("reaction.added", (ctx, e: ReactionAddedEvent) => {
        if (ctx !== this.subscribedConversationContext) return
        this.messages = this.messages.map((m) =>
          m.id === e.messageId ? { ...m, reactions: applyReactionAdded(m.reactions, e.emoji, e.memberId) } : m,
        )
        this.broadcastMessages({ replace: true })
      }),
    )

    this.chatSubs.push(
      events.on("reaction.removed", (ctx, e: ReactionRemovedEvent) => {
        if (ctx !== this.subscribedConversationContext) return
        this.messages = this.messages.map((m) =>
          m.id === e.messageId ? { ...m, reactions: applyReactionRemoved(m.reactions, e.emoji, e.memberId) } : m,
        )
        this.broadcastMessages({ replace: true })
      }),
    )

    this.chatSubs.push(
      events.on("typing", (ctx, e: TypingEvent) => {
        if (ctx !== this.subscribedConversationContext) return
        if (this.currentUserId && e.memberId === this.currentUserId) return
        this.upsertTypingMember(e.memberId)
      }),
    )

    this.chatSubs.push(
      events.on("typing.stop", (ctx, e: TypingEvent) => {
        if (ctx !== this.subscribedConversationContext) return
        this.removeTypingMember(e.memberId)
      }),
    )

    this.chatSubs.push(
      events.on("conversation.status", (ctx, e: ConversationStatusEvent) => {
        if (ctx !== this.subscribedConversationContext) return
        if (e.conversationId !== this.activeConversationId) return
        this.conversationStatus = {
          conversationId: e.conversationId,
          contextTokens: e.contextTokens,
          contextWindow: e.contextWindow,
          model: e.model,
          provider: e.provider,
          at: e.at,
          updatedAt: Date.now(),
        }
        this.post({ type: "kiloclaw.conversationStatus", status: this.conversationStatus })
      }),
    )
  }

  private async refreshOnReconnect(): Promise<void> {
    if (!this.chat || !this.sandboxId) return
    await this.refreshConversations()
    if (this.activeConversationId) {
      await this.refreshActiveMessages()
    }
  }

  // ── Mutations ───────────────────────────────────────────────────────

  private async selectConversation(conversationId: string): Promise<void> {
    if (!this.chat) return
    this.activeConversationId = conversationId
    this.subscribeConversationContext(conversationId)
    this.post({ type: "kiloclaw.activeConversation", conversationId })
    this.typingMembers = []
    for (const t of this.typingTimers.values()) clearTimeout(t)
    this.typingTimers.clear()

    await this.refreshActiveMessages()

    try {
      const res = await this.chat.getConversationStatus(conversationId)
      // The user may have switched conversations while we awaited the fetch;
      // only apply the status if it still matches the active conversation.
      if (this.activeConversationId !== conversationId) return
      this.conversationStatus = res.status ?? null
      this.post({ type: "kiloclaw.conversationStatus", status: this.conversationStatus })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn("[Kilo New] KiloClaw getConversationStatus failed:", message)
      return
    }

    if (this.activeConversationId !== conversationId) return
    void this.markRead(conversationId)
  }

  private async createConversation(title?: string): Promise<void> {
    if (!this.chat || !this.sandboxId) return
    try {
      // The server now returns the full conversation snapshot alongside
      // `conversationId`. We rely on `refreshConversations()` to pick up the
      // canonical list-item shape rather than mapping the detail payload here.
      const res = await this.chat.createConversation({ sandboxId: this.sandboxId, title })
      await this.refreshConversations()
      await this.selectConversation(res.conversationId)
    } catch (err) {
      this.post({ type: "kiloclaw.error", error: this.formatError(err, "Failed to create conversation") })
    }
  }

  private async renameConversation(conversationId: string, title: string): Promise<void> {
    if (!this.chat) return
    this.conversations = this.conversations.map((c) => (c.conversationId === conversationId ? { ...c, title } : c))
    this.broadcastConversations({ replace: true })
    try {
      await this.chat.renameConversation(conversationId, title)
    } catch (err) {
      this.post({ type: "kiloclaw.error", error: this.formatError(err, "Failed to rename conversation") })
      void this.refreshConversations()
    }
  }

  private async leaveConversation(conversationId: string): Promise<void> {
    if (!this.chat) return
    try {
      await this.chat.leaveConversation(conversationId)
      // Optimistic removal — server will also fire conversation.left.
      this.conversations = this.conversations.filter((c) => c.conversationId !== conversationId)
      if (this.activeConversationId === conversationId) {
        this.activeConversationId = null
        this.unsubscribeConversationContext()
        this.messages = []
        this.post({ type: "kiloclaw.activeConversation", conversationId: null })
        this.post({ type: "kiloclaw.messages", conversationId, messages: [], hasMore: false, replace: true })
      }
      this.broadcastConversations({ replace: true })
    } catch (err) {
      this.post({ type: "kiloclaw.error", error: this.formatError(err, "Failed to leave conversation") })
    }
  }

  private async loadMoreConversations(): Promise<void> {
    if (!this.chat || !this.sandboxId || !this.hasMoreConversations || !this.conversationsCursor) return
    const target = this.sandboxId
    const cursor = this.conversationsCursor
    try {
      const res = await this.chat.listConversations({
        sandboxId: target,
        limit: CONVERSATIONS_PAGE,
        cursor,
      })
      // Sandbox could have changed (reauth / cleanup). Also a newer refresh
      // may have already moved the cursor — skip merging stale results.
      if (this.sandboxId !== target || this.conversationsCursor !== cursor) return
      this.conversations = mergeConversations(this.conversations, res.conversations)
      this.conversationsCursor = res.nextCursor
      this.hasMoreConversations = res.hasMore
      this.broadcastConversations({ replace: true })
    } catch (err) {
      this.post({ type: "kiloclaw.error", error: this.formatError(err, "Failed to load conversations") })
    }
  }

  private async sendMessage(
    conversationId: string,
    content: ContentBlock[],
    inReplyToMessageId?: string,
  ): Promise<void> {
    if (!this.chat) return
    if (!this.currentUserId) return

    // kilo-chat validates clientId as a ULID (Crockford Base32); generate
    // it here so the webview doesn't need to know the format.
    const clientId = ulid()
    const pendingId = `pending-${clientId}`
    const optimistic: Message = {
      id: pendingId,
      senderId: this.currentUserId,
      content,
      inReplyToMessageId: inReplyToMessageId ?? null,
      updatedAt: null,
      clientUpdatedAt: null,
      deleted: false,
      deliveryFailed: false,
      reactions: [],
    }

    if (conversationId === this.activeConversationId) {
      this.messages = [...this.messages, optimistic]
      this.post({ type: "kiloclaw.messageOptimistic", conversationId, message: optimistic })
    }

    try {
      await this.chat.sendMessage({ conversationId, content, clientId, inReplyToMessageId })
      // Server will fire `message.created` — reconciliation happens there.
    } catch (err) {
      console.error("[Kilo New] KiloClaw sendMessage failed:", err instanceof Error ? err.message : err)
      this.post({ type: "kiloclaw.error", error: this.formatError(err, "Failed to send message") })
      if (conversationId === this.activeConversationId) {
        this.messages = this.messages.filter((m) => m.id !== pendingId)
        this.post({ type: "kiloclaw.messageRemoved", conversationId, messageId: pendingId })
      }
    }
  }

  private async editMessage(conversationId: string, messageId: string, content: ContentBlock[]): Promise<void> {
    if (!this.chat) return
    const snapshot = this.messages.find((m) => m.id === messageId)
    if (snapshot && conversationId === this.activeConversationId) {
      this.messages = this.messages.map((m) =>
        m.id === messageId ? { ...m, content, clientUpdatedAt: Date.now() } : m,
      )
      this.broadcastMessages({ replace: true })
    }
    try {
      await this.chat.editMessage(messageId, { conversationId, content, timestamp: Date.now() })
    } catch (err) {
      this.post({ type: "kiloclaw.error", error: this.formatError(err, "Failed to edit message") })
      if (snapshot && conversationId === this.activeConversationId) {
        this.messages = this.messages.map((m) => (m.id === messageId ? snapshot : m))
        this.broadcastMessages({ replace: true })
      }
    }
  }

  private async deleteMessage(conversationId: string, messageId: string): Promise<void> {
    if (!this.chat) return
    const snapshot = this.messages.find((m) => m.id === messageId)
    if (snapshot && conversationId === this.activeConversationId) {
      this.messages = this.messages.map((m) => (m.id === messageId ? { ...m, deleted: true } : m))
      this.broadcastMessages({ replace: true })
    }
    try {
      await this.chat.deleteMessage(messageId, conversationId)
    } catch (err) {
      this.post({ type: "kiloclaw.error", error: this.formatError(err, "Failed to delete message") })
      if (snapshot && conversationId === this.activeConversationId) {
        this.messages = this.messages.map((m) => (m.id === messageId ? snapshot : m))
        this.broadcastMessages({ replace: true })
      }
    }
  }

  private async loadMoreMessages(conversationId: string, before: string): Promise<void> {
    if (!this.chat || conversationId !== this.activeConversationId) return
    try {
      const res = await this.chat.listMessages(conversationId, { before, limit: MESSAGES_PAGE })
      // The user may have switched conversations while we awaited the fetch;
      // only merge if the active conversation is still the same.
      if (this.activeConversationId !== conversationId) return
      const sorted = sortMessagesAscending(res.messages)
      this.messages = mergeMessages(sorted, this.messages)
      this.hasMoreMessages = res.hasMore
      this.broadcastMessages({ replace: true })
    } catch (err) {
      this.post({ type: "kiloclaw.error", error: this.formatError(err, "Failed to load messages") })
    }
  }

  private async addReaction(conversationId: string, messageId: string, emoji: string): Promise<void> {
    if (!this.chat || !this.currentUserId) return
    const snapshot = this.messages.find((m) => m.id === messageId)
    if (snapshot && conversationId === this.activeConversationId) {
      this.messages = this.messages.map((m) =>
        m.id === messageId ? { ...m, reactions: applyReactionAdded(m.reactions, emoji, this.currentUserId!) } : m,
      )
      this.broadcastMessages({ replace: true })
    }
    try {
      await this.chat.addReaction(messageId, { conversationId, emoji })
    } catch (err) {
      this.post({ type: "kiloclaw.error", error: this.formatError(err, "Failed to add reaction") })
      if (snapshot && conversationId === this.activeConversationId) {
        this.messages = this.messages.map((m) => (m.id === messageId ? snapshot : m))
        this.broadcastMessages({ replace: true })
      }
    }
  }

  private async removeReaction(conversationId: string, messageId: string, emoji: string): Promise<void> {
    if (!this.chat || !this.currentUserId) return
    const snapshot = this.messages.find((m) => m.id === messageId)
    if (snapshot && conversationId === this.activeConversationId) {
      this.messages = this.messages.map((m) =>
        m.id === messageId ? { ...m, reactions: applyReactionRemoved(m.reactions, emoji, this.currentUserId!) } : m,
      )
      this.broadcastMessages({ replace: true })
    }
    try {
      await this.chat.removeReaction(messageId, { conversationId, emoji })
    } catch (err) {
      this.post({ type: "kiloclaw.error", error: this.formatError(err, "Failed to remove reaction") })
      if (snapshot && conversationId === this.activeConversationId) {
        this.messages = this.messages.map((m) => (m.id === messageId ? snapshot : m))
        this.broadcastMessages({ replace: true })
      }
    }
  }

  private async executeAction(
    conversationId: string,
    messageId: string,
    groupId: string,
    value: ExecApprovalDecision,
  ): Promise<void> {
    if (!this.chat || !this.currentUserId) return
    const snapshot = this.messages.find((m) => m.id === messageId)
    if (snapshot && conversationId === this.activeConversationId) {
      this.messages = this.messages.map((m) => {
        if (m.id !== messageId) return m
        return {
          ...m,
          content: m.content.map((b) => {
            if (b.type !== "actions") return b
            if (b.groupId !== groupId) return b
            return { ...b, resolved: { value, resolvedBy: this.currentUserId!, resolvedAt: Date.now() } }
          }),
        }
      })
      this.broadcastMessages({ replace: true })
    }
    try {
      await this.chat.executeAction(conversationId, messageId, { groupId, value })
    } catch (err) {
      this.post({ type: "kiloclaw.error", error: this.formatError(err, "Failed to execute action") })
      if (snapshot && conversationId === this.activeConversationId) {
        this.messages = this.messages.map((m) => (m.id === messageId ? snapshot : m))
        this.broadcastMessages({ replace: true })
      }
    }
  }

  private async sendTyping(conversationId: string): Promise<void> {
    if (!this.chat || conversationId !== this.activeConversationId) return
    try {
      await this.chat.sendTyping(conversationId)
    } catch (err) {
      // Typing is fire-and-forget; don't surface errors.
      void err
    }
  }

  private async sendTypingStop(conversationId: string): Promise<void> {
    if (!this.chat || conversationId !== this.activeConversationId) return
    try {
      await this.chat.sendTypingStop(conversationId)
    } catch (err) {
      void err
    }
  }

  private async markRead(conversationId: string): Promise<void> {
    if (!this.chat) return
    if (conversationId !== this.activeConversationId) return
    // The mark-read endpoint requires `lastSeenMessageId`. With no messages
    // loaded there is nothing to mark — silently skip.
    const last = lastNonPendingMessageId(this.messages)
    if (!last) return
    try {
      await this.chat.markConversationRead(conversationId, { lastSeenMessageId: last })
    } catch (err) {
      void err
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private async refreshConversations(): Promise<void> {
    if (!this.chat) return
    const target = this.sandboxId
    if (!target) return
    try {
      const list = await this.chat.listConversations({ sandboxId: target, limit: CONVERSATIONS_PAGE })
      // Defensive: sandbox could theoretically change during the fetch
      // (cleanup or reauth). Skip the write if so.
      if (this.sandboxId !== target) return
      this.conversations = list.conversations
      this.conversationsCursor = list.nextCursor
      this.hasMoreConversations = list.hasMore
      this.broadcastConversations({ replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn("[Kilo New] KiloClaw refreshConversations failed:", message)
    }
  }

  private async refreshActiveMessages(): Promise<void> {
    if (!this.chat) return
    const target = this.activeConversationId
    if (!target) return
    try {
      const res = await this.chat.listMessages(target, { limit: MESSAGES_PAGE })
      // The user may have switched conversations while we awaited the fetch;
      // only apply the messages if the active conversation is still `target`.
      if (this.activeConversationId !== target) return
      this.messages = sortMessagesAscending(res.messages)
      this.hasMoreMessages = res.hasMore
      this.broadcastMessages({ replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn("[Kilo New] KiloClaw refreshActiveMessages failed:", message)
    }
  }

  private upsertTypingMember(memberId: string): void {
    const now = Date.now()
    const idx = this.typingMembers.findIndex((m) => m.memberId === memberId)
    if (idx === -1) {
      this.typingMembers = [...this.typingMembers, { memberId, at: now }]
    } else {
      this.typingMembers = this.typingMembers.map((m, i) => (i === idx ? { ...m, at: now } : m))
    }
    if (this.activeConversationId) {
      this.post({ type: "kiloclaw.typing", conversationId: this.activeConversationId, memberId })
    }
    const existing = this.typingTimers.get(memberId)
    if (existing) clearTimeout(existing)
    this.typingTimers.set(
      memberId,
      setTimeout(() => this.removeTypingMember(memberId), TYPING_TIMEOUT_MS),
    )
  }

  private removeTypingMember(memberId: string): void {
    this.typingMembers = this.typingMembers.filter((m) => m.memberId !== memberId)
    const t = this.typingTimers.get(memberId)
    if (t) {
      clearTimeout(t)
      this.typingTimers.delete(memberId)
    }
    if (this.activeConversationId) {
      this.post({ type: "kiloclaw.typingStop", conversationId: this.activeConversationId, memberId })
    }
  }

  private toMessageFromCreated(e: MessageCreatedEvent): Message {
    return {
      id: e.messageId,
      senderId: e.senderId,
      content: e.content,
      inReplyToMessageId: e.inReplyToMessageId,
      updatedAt: null,
      clientUpdatedAt: null,
      deleted: false,
      deliveryFailed: false,
      reactions: [],
    }
  }

  private broadcastConversations(opts: { replace: boolean }): void {
    this.post({
      type: "kiloclaw.conversations",
      conversations: this.conversations,
      hasMore: this.hasMoreConversations,
      replace: opts.replace,
    })
  }

  private broadcastMessages(opts: { replace: boolean }): void {
    if (!this.activeConversationId) return
    this.post({
      type: "kiloclaw.messages",
      conversationId: this.activeConversationId,
      messages: this.messages,
      hasMore: this.hasMoreMessages,
      replace: opts.replace,
    })
  }

  private formatError(err: unknown, fallback: string): string {
    if (err instanceof KiloChatApiError) {
      const body = err.body as Record<string, unknown> | null
      if (body && typeof body.error === "string") return body.error
    }
    if (err instanceof Error) return err.message || fallback
    return fallback
  }

  // ── Polling / nudges / cleanup ──────────────────────────────────────

  private startPolling(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.poll(), STATUS_POLL_MS)
  }

  private stopPolling(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  private startBotNudge(): void {
    if (this.botNudge) return
    this.botNudge = setInterval(() => {
      if (!this.chat || !this.sandboxId) return
      this.chat.requestBotStatus(this.sandboxId).catch((err) => {
        console.debug("[Kilo New] KiloClaw requestBotStatus failed:", (err as Error)?.message ?? err)
      })
    }, BOT_STATUS_NUDGE_MS)
  }

  private stopBotNudge(): void {
    if (!this.botNudge) return
    clearInterval(this.botNudge)
    this.botNudge = null
  }

  private async poll(): Promise<void> {
    try {
      const client = this.connection.getClient()
      const res = await client.kilo.claw.status()
      if (res?.data) {
        this.status = res.data as ClawStatus
        this.post({ type: "kiloclaw.status", data: this.status })
      }
    } catch (err) {
      console.debug("[Kilo New] KiloClaw poll failed:", (err as Error)?.message ?? err)
    }
  }

  private cleanup(): void {
    this.generation++

    for (const unsub of this.subs) unsub()
    this.subs = []
    for (const unsub of this.chatSubs) unsub()
    this.chatSubs = []

    this.stopPolling()
    this.stopBotNudge()

    for (const t of this.typingTimers.values()) clearTimeout(t)
    this.typingTimers.clear()

    this.events?.disconnect()
    this.events = null
    this.chat = null
    this.tokens?.clear()
    this.tokens = null

    this.subscribedSandboxContext = null
    this.subscribedConversationContext = null

    this.messages = []
    this.conversations = []
    this.conversationsCursor = null
    this.hasMoreConversations = false
    this.activeConversationId = null
    this.hasMoreMessages = false
    this.botStatus = null
    this.conversationStatus = null
    this.typingMembers = []
    this.initializing = false
    this.status = null
    this.currentUserId = null
    this.sandboxId = null
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────

function applyReactionAdded(
  reactions: { emoji: string; count: number; memberIds: string[] }[],
  emoji: string,
  memberId: string,
): { emoji: string; count: number; memberIds: string[] }[] {
  const existing = reactions.find((r) => r.emoji === emoji)
  if (existing) {
    if (existing.memberIds.includes(memberId)) return reactions
    return reactions.map((r) =>
      r.emoji === emoji ? { ...r, count: r.count + 1, memberIds: [...r.memberIds, memberId] } : r,
    )
  }
  return [...reactions, { emoji, count: 1, memberIds: [memberId] }]
}

function applyReactionRemoved(
  reactions: { emoji: string; count: number; memberIds: string[] }[],
  emoji: string,
  memberId: string,
): { emoji: string; count: number; memberIds: string[] }[] {
  return reactions
    .map((r) => {
      if (r.emoji !== emoji) return r
      const memberIds = r.memberIds.filter((id) => id !== memberId)
      return { ...r, count: memberIds.length, memberIds }
    })
    .filter((r) => r.count > 0)
}

/** Merge two ascending-sorted message arrays by id, keeping the most recent updates. */
function mergeMessages(older: Message[], newer: Message[]): Message[] {
  const seen = new Map<string, Message>()
  for (const m of older) seen.set(m.id, m)
  for (const m of newer) seen.set(m.id, m)
  return [...seen.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function mergeConversations(
  existing: ConversationListItem[],
  incoming: ConversationListItem[],
): ConversationListItem[] {
  const seen = new Map<string, ConversationListItem>()
  for (const c of existing) seen.set(c.conversationId, c)
  for (const c of incoming) seen.set(c.conversationId, c)
  return [...seen.values()].sort((a, b) => {
    const ax = a.lastActivityAt ?? a.joinedAt
    const bx = b.lastActivityAt ?? b.joinedAt
    return bx - ax
  })
}

/** listMessages returns newest-first; the UI renders oldest-first. */
function sortMessagesAscending(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * Pick the latest server-confirmed message id from an ascending list. Pending
 * (optimistic) messages use `pending-<clientId>` ids that the server doesn't
 * recognise, so they're skipped — the new mark-read contract requires a real
 * message id.
 */
function lastNonPendingMessageId(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m) continue
    if (m.id.startsWith("pending-")) continue
    return m.id
  }
  return null
}
