/** @jsxImportSource solid-js */

/**
 * MessageList component
 * Scrollable turn-based message list with virtualization.
 * Each user message is rendered as a VscodeSessionTurn — a custom component that
 * renders all assistant parts as a flat, verbose list with no context grouping,
 * and fully expands sub-agent (task tool) parts inline.
 * Shows recent sessions in the empty state for quick resumption.
 */

import { type Component, type JSX, For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { WelcomeEmptyState } from "./WelcomeEmptyState"
import { TranscriptRowView } from "./TranscriptRow"
import type { ErrorDisplayProps } from "./ErrorDisplay"
import { RevertBanner } from "./RevertBanner"
import { AccountSwitcher } from "../shared/AccountSwitcher"
import { KiloNotifications } from "./KiloNotifications"
import { WorkingIndicator } from "../shared/WorkingIndicator"
import { TurnOutcome } from "../shared/TurnOutcome"
import { QuestionDock } from "./QuestionDock"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import { SuggestBar } from "./SuggestBar"
import {
  getMeasurement,
  getScroll,
  layoutFingerprint,
  resolveAnchor,
  rowFingerprint,
  setMeasurement,
  setScroll,
} from "./transcript-cache"
import {
  activeUserMessageID as getActiveUserMessageID,
  messageTurns,
  queuedUserMessageIDs,
  stableMessageTurns,
  type MessageTurn,
} from "../../context/session-queue"
import {
  partitionRows,
  retainTurn,
  transcriptRows,
  type TranscriptErrorRow,
  type TranscriptHold,
  type TranscriptRow,
} from "../../context/transcript-rows"
import { useTranscriptSearch, type SearchMatch } from "../../context/transcript-search"
import { applyTranscriptHighlights, clearTranscriptHighlights } from "./transcript-search-highlight"
import {
  isUnauthorizedPaidModelError,
  isUnauthorizedPromotionLimitError,
  parseAssistantError,
  parseProviderAuthError,
  unwrapError,
} from "../../utils/errorUtils"
import type { Part, QuestionRequest, SuggestionRequest } from "../../types/messages"

interface MessageListProps {
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
  onForkMessage?: (sessionId: string, messageId: string) => void
  /** Non-tool question requests to render inline at the bottom of the message list */
  questions?: () => QuestionRequest[]
  /** Non-tool suggestion requests to render inline at the bottom of the message list */
  suggestions?: () => SuggestionRequest[]
  /** When true (subagent viewer), replace the welcome screen with an initializing indicator */
  readonly?: boolean
  /** Optionally replace the standard welcome content while the conversation is empty. */
  emptyState?: () => JSX.Element
  /** Announce transcript changes as a live log. Disable for multi-session surfaces with concurrent streams. */
  announce?: boolean
}

export const MessageList: Component<MessageListProps> = (props) => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const provider = useProvider()

  const autoScroll = createAutoScroll({
    working: () => session.status() !== "idle",
  })
  const [announcement, setAnnouncement] = createSignal("")
  createEffect(
    (prev: { sid?: string; working: boolean }) => {
      const sid = session.currentSessionID()
      const working = session.status() !== "idle"
      if (working && (!prev.working || prev.sid !== sid)) setAnnouncement(language.t("session.status.working"))
      if (!working && prev.working && prev.sid === sid) {
        setAnnouncement(language.t("settings.agentBehaviour.editMode.save"))
      }
      return { sid, working }
    },
    { sid: undefined, working: false },
  )

  // Explicit output-producing actions resume auto-scroll before appending.
  const onResumeAutoScroll = () => autoScroll.resume()
  window.addEventListener("resumeAutoScroll", onResumeAutoScroll)
  onCleanup(() => window.removeEventListener("resumeAutoScroll", onResumeAutoScroll))

  let loaded = false
  createEffect(() => {
    if (!loaded && server.isConnected() && session.sessions().length === 0) {
      loaded = true
      session.loadSessions()
    }
  })

  const [scrollEl, setScrollEl] = createSignal<HTMLElement>()
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>()
  const [layout, setLayout] = createSignal("")

  const revert = () => session.revert() ?? undefined
  const turns = createMemo((prev: MessageTurn[] | undefined) =>
    stableMessageTurns(
      messageTurns(session.messages(), revert(), (msg) => session.getParts(msg.id)),
      prev,
    ),
  )
  const isEmpty = () => turns().length === 0 && !session.loading() && !revert()

  const activeUserID = createMemo(() =>
    getActiveUserMessageID(session.messages(), session.statusInfo(), (msg) => session.getParts(msg.id)),
  )
  const queuedIDs = createMemo(
    () => new Set(queuedUserMessageIDs(session.messages(), session.statusInfo(), (msg) => session.getParts(msg.id))),
  )
  const rows = createMemo((prev: TranscriptRow[] | undefined) => {
    const active = activeUserID()
    return transcriptRows(
      turns(),
      (msg) => session.getParts(msg),
      {
        queued: queuedIDs(),
        live: new Set(active ? [active] : []),
        hidden: session.isErrorHidden,
        revert: revert(),
      },
      prev,
    )
  })

  const search = useTranscriptSearch()

  function rowText(row: TranscriptRow): string {
    if (row.type === "error") return errorText(row.error)
    if (row.type === "diff") return ""
    const chunks: string[] = []
    for (const part of row.parts) {
      switch (part.type) {
        case "text":
          if (!part.synthetic) chunks.push(part.text)
          break
        case "reasoning":
          chunks.push(part.text)
          break
        case "tool":
          chunks.push(...toolText(part))
          break
        case "file":
          if (part.filename) chunks.push(part.filename)
          break
      }
    }
    return chunks.join("\n")
  }

  // Mirrors ErrorDisplay.tsx's exact Switch/Match classification so search
  // text matches what's actually on screen for every error variant, not
  // just the default card: the paid-model and promotion-limit prompts
  // render fixed localized copy (no user data at all), and the provider
  // auth prompt only renders when canAuth() would be true there too —
  // otherwise ErrorDisplay itself falls through to the default card.
  function errorText(error: TranscriptErrorRow["error"]): string {
    const value = error as ErrorDisplayProps["error"]
    const parsed = parseAssistantError(value)
    if (isUnauthorizedPaidModelError(parsed)) {
      return [language.t("error.paidModel.title"), language.t("error.paidModel.description")].join("\n")
    }
    if (isUnauthorizedPromotionLimitError(parsed)) {
      return [language.t("error.promotionLimit.title"), language.t("error.promotionLimit.description")].join("\n")
    }
    const auth = parseProviderAuthError(value)
    const authProvider = auth ? provider.providers()[auth.providerID] : undefined
    const authMethods = auth ? (provider.authMethods()[auth.providerID] ?? []) : []
    if (auth && authProvider && authMethods.length > 0) {
      const oauth = auth.providerID === "openai" && authMethods.some((method) => method.type === "oauth")
      const name = authProvider.name ?? auth.providerID
      const title = oauth
        ? language.t("error.providerAuth.chatgpt.title")
        : language.t("error.providerAuth.title", { provider: name })
      const description = oauth
        ? language.t("error.providerAuth.chatgpt.description")
        : language.t("error.providerAuth.description", { provider: name })
      return [title, description].join("\n")
    }
    const msg = error.data?.message
    if (typeof msg !== "string") return ""
    return unwrapError(msg)
  }

  // Extracts only the text kilo-ui's tool renderers actually put on screen —
  // matched field-by-field rather than reading `state.title` generically.
  // The bash/shell renderer never shows `state.title` (its header is a
  // static "Shell" label); the visible command/description come from
  // `state.input` instead, and its output is shown as plain scrollable
  // text. Other tools' `state.output` is typically internal data (file
  // contents, JSON) that isn't rendered inline, so including it — or bash's
  // unused `title` — produces search matches with no corresponding
  // highlight, which is what made navigation appear to skip past matches.
  function toolText(part: Part & { type: "tool" }): string[] {
    const state = part.state
    if (state.status === "running") return state.title ? [state.title] : []
    if (state.status === "error") return state.error ? [state.error] : []
    if (state.status !== "completed") return []
    if (part.tool !== "bash") return state.title ? [state.title] : []
    const input = state.input as { command?: string; description?: string } | undefined
    const metadata = state.metadata as { command?: string; description?: string } | undefined
    const command = input?.command ?? metadata?.command
    const description = input?.description ?? metadata?.description
    const chunks: string[] = []
    // DOM order: description renders as the header subtitle (above the
    // command box), command renders below it, output last — keep this in
    // sync with shell-rolling-results.tsx so occurrence numbering lines up
    // with what's actually highlighted on screen.
    if (description) chunks.push(description)
    if (command) chunks.push(command)
    if (state.output) chunks.push(state.output)
    return chunks
  }

  function buildPattern(query: string, matchCase: boolean, wholeWord: boolean, regex: boolean): RegExp | undefined {
    if (!query) return undefined
    try {
      let pattern = query
      if (!regex) {
        pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      }
      if (wholeWord) {
        pattern = `\\b(?:${pattern})\\b`
      }
      return new RegExp(pattern, matchCase ? "g" : "gi")
    } catch {
      return undefined
    }
  }

  const pattern = createMemo(() => {
    const q = search.query()
    if (!search.active() || !q) return undefined
    return buildPattern(q, search.matchCase(), search.wholeWord(), search.regex())
  })

  // An invalid regex (e.g. an unbalanced group) compiles to `undefined` from
  // buildPattern, which otherwise looks identical to "no matches" — surface
  // it explicitly so the widget can show a real error instead.
  createEffect(() => {
    const q = search.query()
    search.setInvalid(search.active() && !!q && search.regex() && !pattern())
  })

  const matches = createMemo(() => {
    const p = pattern()
    if (!p) return []
    const list = rows()
    const result: SearchMatch[] = []
    for (const row of list) {
      const text = rowText(row)
      p.lastIndex = 0
      let occurrence = 0
      let hit = p.exec(text)
      while (hit) {
        if (hit[0].length === 0) {
          p.lastIndex += 1
          hit = p.exec(text)
          continue
        }
        result.push({ key: row.key, messageId: row.message.id, occurrence })
        occurrence += 1
        hit = p.exec(text)
      }
    }
    return result
  })

  createEffect(
    on(matches, (m) => {
      search.setCount(m.length)
      if (m.length === 0) {
        search.setIndex(0)
        return
      }
      const idx = search.index()
      if (idx >= m.length) search.setIndex(m.length - 1)
    }),
  )

  createEffect(
    on(
      () => [search.query(), search.matchCase(), search.wholeWord(), search.regex()],
      () => search.setIndex(0),
    ),
  )

  // Closing/switching to a different session leaves stale query/matches
  // bound to a transcript that's no longer displayed if left untouched —
  // reset the whole widget whenever the current session changes. `defer:
  // true` skips the initial run so mounting doesn't immediately "reset" a
  // session that was never open in this search widget.
  createEffect(
    on(
      () => session.currentSessionID(),
      () => {
        search.setActive(false)
        search.setQuery("")
        search.setMatchCase(false)
        search.setWholeWord(false)
        search.setRegex(false)
        search.setIndex(0)
        search.setCount(0)
      },
      { defer: true },
    ),
  )

  const activeKey = createMemo(() => {
    const m = matches()
    const idx = search.index()
    return m[idx]?.key
  })

  const activeMatch = createMemo(() => matches()[search.index()])

  // Highlights every rendered occurrence of the query (not just matching
  // rows) via the CSS Custom Highlight API, and returns the precise Range of
  // the current occurrence so navigation can judge whether it needs to
  // scroll at all (several occurrences can share one message).
  let highlightFrame: number | undefined
  let highlightFrameInner: number | undefined
  let pendingCenter = false
  const paintHighlights = () => {
    const el = scrollEl()
    if (!el || !search.active()) {
      clearTranscriptHighlights()
      return
    }
    const active = activeMatch()
    const range = applyTranscriptHighlights(el, pattern(), active && { key: active.key, occurrence: active.occurrence })
    if (!pendingCenter) return
    pendingCenter = false
    if (!range) return
    // Only nudge the scroll position when the match isn't already
    // comfortably placed — re-centering on every single step (even when
    // the match is already visible) reads as constant, distracting jumping
    // when several occurrences share one message.
    const rect = range.getClientRects()[0]
    if (!rect) return
    const box = el.getBoundingClientRect()
    const fullyVisible = rect.top >= box.top && rect.bottom <= box.bottom
    // Comfort band covers the middle 70% of the viewport (15% margin top
    // and bottom) — wide enough that most steps between nearby matches
    // don't scroll at all, while still recentering before a match gets
    // uncomfortably close to the edge.
    const comfortMargin = box.height * 0.35
    const centered = Math.abs(rect.top + rect.height / 2 - (box.top + box.height / 2)) <= comfortMargin
    if (fullyVisible && centered) return
    const container = range.startContainer
    const target = container instanceof Element ? container : container?.parentElement
    target?.scrollIntoView({ block: "center", inline: "nearest" })
  }

  // Two frames of margin so the virtualizer has settled the DOM for the new
  // scroll position before we scan it for the precise occurrence to center.
  // Both frame ids are tracked so cleanup can cancel whichever leg of the
  // chain hasn't fired yet — cancelling only the outer id left the inner,
  // already-scheduled frame free to fire (and touch reactive state) after
  // the component had already unmounted.
  const scheduleHighlight = () => {
    if (highlightFrame !== undefined) return
    highlightFrame = requestAnimationFrame(() => {
      highlightFrameInner = requestAnimationFrame(() => {
        highlightFrame = undefined
        highlightFrameInner = undefined
        paintHighlights()
      })
    })
  }

  createEffect(
    on(
      () => [search.query(), search.matchCase(), search.wholeWord(), search.regex(), search.active(), activeMatch()],
      scheduleHighlight,
    ),
  )

  createEffect(
    on(
      () => search.jump(),
      () => {
        const m = matches()
        const idx = search.index()
        if (!m.length || idx < 0 || idx >= m.length) return
        const match = m[idx]
        if (!match) return
        autoScroll.pause()
        pendingCenter = true
        const el = scrollEl()
        const mounted = el?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(match.key)}"]`)
        // Only force the coarse row-level scroll when the row isn't in the
        // DOM at all (virtualized out). If it's already mounted, defer
        // entirely to the precise per-occurrence check in paintHighlights,
        // which only scrolls when the exact match actually needs it.
        if (!mounted) {
          const index = keys().indexOf(match.key)
          if (index >= 0) {
            virtualizer()?.scrollToIndex(index, { align: "center" })
          }
        }
        scheduleHighlight()
      },
    ),
  )

  onCleanup(() => {
    if (highlightFrame !== undefined) cancelAnimationFrame(highlightFrame)
    if (highlightFrameInner !== undefined) cancelAnimationFrame(highlightFrameInner)
    clearTranscriptHighlights()
  })

  const [held, setHeld] = createSignal<TranscriptHold>()
  createEffect(() => {
    const id = activeUserID()
    const sid = session.currentSessionID()
    const paused = autoScroll.userScrolled()
    setHeld((prev) => retainTurn(prev, sid, id, paused))
  })
  const direct = createMemo(() => {
    const item = held()
    const ids = new Set<string>()
    if (item && item.sid === session.currentSessionID()) ids.add(item.turn)
    const active = activeUserID()
    if (active) ids.add(active)
    return ids
  })
  // Virtua continues to own completed history and stable live chunks, but not
  // the growing assistant suffix whose measurements would produce visible jumps.
  const partition = createMemo(() => partitionRows(rows(), direct()))
  const tail = createMemo(() => partition().direct.map((row) => row.key))
  const lookup = createMemo(() => new Map(partition().direct.map((row) => [row.key, row])))
  const keys = createMemo(() => partition().virtual.map((row) => row.key))
  const fingerprint = createMemo(() => rowFingerprint(keys()))

  // Clicking a bar in the task timeline scrolls the transcript to that message.
  // Jumps land instantly (no smooth animation): while pinned at the bottom, a
  // smooth scroll's initial frames sit within createAutoScroll's near-bottom
  // threshold, which resumes auto-follow mid-animation and snaps back down.
  const onScrollToMessage = (e: Event) => {
    const detail = (e as CustomEvent<{ id: string; partId?: string }>).detail
    if (!detail?.id) return
    const matches = rows().filter((r) => r.type === "assistant" && r.message.id === detail.id)
    // Long messages split into multiple rows (chunks); land on the chunk that
    // actually contains the clicked part, not just the message's first chunk.
    const row = matches.find((r) => r.type === "assistant" && r.parts.some((p) => p.id === detail.partId)) ?? matches[0]
    if (!row) return
    autoScroll.pause()
    const index = keys().indexOf(row.key)
    if (index >= 0) {
      virtualizer()?.scrollToIndex(index, { align: "start" })
      return
    }
    const el = scrollEl()
    const target = el?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(row.key)}"]`)
    target?.scrollIntoView({ block: "start" })
  }
  window.addEventListener("scrollToMessage", onScrollToMessage)
  onCleanup(() => window.removeEventListener("scrollToMessage", onScrollToMessage))

  const measurement = createMemo(() => {
    const id = session.currentSessionID()
    const token = layout()
    if (!id || !token || session.loading() || keys().length === 0) return undefined
    return getMeasurement(id, fingerprint(), token)
  })

  let active = { id: session.currentSessionID(), keys: keys(), fingerprint: fingerprint() }
  createEffect(() => {
    const id = session.currentSessionID()
    const current = keys()
    const value = fingerprint()
    if (!id || session.loading() || active.id !== id) return
    active = { id, keys: current, fingerprint: value }
  })

  const save = (id: string | undefined, saved = active) => {
    const el = scrollEl()
    if (!id || !el || saved.id !== id) return
    const handle = virtualizer()
    const token = layout()
    if (handle && token && saved.keys.length > 0) {
      setMeasurement(id, saved.fingerprint, token, handle.cache)
    }
    if (!autoScroll.userScrolled()) {
      setScroll(id, { type: "bottom" })
      return
    }
    if (!handle || saved.keys.length === 0) return
    const index = handle.findStartIndex()
    const key = saved.keys[index]
    if (!key) return
    setScroll(id, { type: "anchor", key, offset: handle.scrollOffset - handle.getItemOffset(index) })
  }

  const maybeLoadOlder = () => {
    const el = scrollEl()
    if (!el || el.scrollTop > 600) return
    session.loadOlderMessages()
  }

  const handleScroll = () => {
    autoScroll.handleScroll()
    maybeLoadOlder()
    if (search.active()) scheduleHighlight()
  }

  let resize: ResizeObserver | undefined
  const refreshLayout = () => {
    const el = scrollEl()
    if (!el) return
    const style = getComputedStyle(el)
    setLayout(
      layoutFingerprint({
        width: Math.round(el.clientWidth),
        ratio: window.devicePixelRatio,
        font: style.fontFamily,
        size: style.fontSize,
        line: style.lineHeight,
      }),
    )
  }
  const setScrollRef = (el: HTMLElement | undefined) => {
    resize?.disconnect()
    setScrollEl(el)
    autoScroll.scrollRef(el)
    if (!el) return
    refreshLayout()
    resize = new ResizeObserver(refreshLayout)
    resize.observe(el)
  }
  window.addEventListener("resize", refreshLayout)
  document.fonts?.addEventListener("loadingdone", refreshLayout)
  onCleanup(() => {
    resize?.disconnect()
    window.removeEventListener("resize", refreshLayout)
    document.fonts?.removeEventListener("loadingdone", refreshLayout)
  })

  const [pendingRestore, setPendingRestore] = createSignal<string>()

  createEffect(
    on(session.currentSessionID, (id, prev) => {
      save(prev)
      active = { id, keys: [], fingerprint: rowFingerprint([]) }
      setPendingRestore(id)
    }),
  )

  createEffect(() => {
    const id = pendingRestore()
    if (!id || session.loading()) return
    turns().length
    // Double-rAF: the first frame lets the browser paint the new DOM from
    // the messagesLoaded batch. The second frame restores scroll position
    // without forcing a synchronous layout reflow mid-paint.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (pendingRestore() !== id) return
        const el = scrollEl()
        if (!el) return
        const state = getScroll(id)
        const anchor = resolveAnchor(state, keys())
        const handle = virtualizer()
        if (state?.type === "anchor" && anchor && handle) {
          handle.scrollToIndex(anchor.index, { offset: anchor.offset })
          autoScroll.pause()
          maybeLoadOlder()
        } else {
          autoScroll.forceScrollToBottom()
        }
        setPendingRestore(undefined)
      })
    })
  })

  onCleanup(() => save(session.currentSessionID()))

  return (
    <div class="message-list-container">
      <Show when={props.announce === false}>
        <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement()}
        </div>
      </Show>
      <Show when={isEmpty()}>
        <div class="welcome-header">
          <AccountSwitcher class="account-switcher-welcome" />
          <KiloNotifications />
        </div>
      </Show>
      <div
        ref={setScrollRef}
        onScroll={handleScroll}
        class="message-list"
        role={props.announce === false ? undefined : "log"}
        aria-live={props.announce === false ? undefined : "polite"}
        aria-busy={props.announce === false && session.status() !== "idle" ? "true" : undefined}
      >
        <div ref={autoScroll.contentRef} class={isEmpty() ? "message-list-content-empty" : "message-list-content"}>
          <Show when={session.loading()}>
            <div class="message-list-loading" role="status">
              <Spinner />
              <span>{language.t("session.messages.loading")}</span>
            </div>
          </Show>
          <Show when={isEmpty() && props.readonly}>
            <div class="message-list-empty">
              <p class="kilo-about-text">{language.t("session.messages.initializing")}</p>
            </div>
          </Show>
          <Show when={isEmpty() && !props.readonly}>
            {props.emptyState ? (
              props.emptyState()
            ) : (
              <WelcomeEmptyState onSelectSession={props.onSelectSession} onShowHistory={props.onShowHistory} />
            )}
          </Show>
          <Show when={!session.loading() && !isEmpty()}>
            <Show when={session.loadingOlderMessages()}>
              <div class="message-list-page-loader" role="status">
                <Spinner />
                <span>{language.t("session.messages.loadingEarlier")}</span>
              </div>
            </Show>
            <Show when={session.hasOlderMessages() && !session.loadingOlderMessages()}>
              <button class="message-list-load-older" onClick={() => session.loadOlderMessages()}>
                {language.t("session.messages.loadEarlier")}
              </button>
            </Show>
            <Show when={partition().virtual.length > 0 || partition().direct.length > 0}>
              <div
                class="message-list-turns"
                data-loaded-messages={session.messages().length}
                data-row-count={partition().virtual.length}
                data-direct-count={partition().direct.length}
                data-queued-count={partition().queued.length}
              >
                <Show when={scrollEl() && partition().virtual.length > 0}>
                  <Virtualizer
                    ref={setVirtualizer}
                    data={partition().virtual}
                    scrollRef={scrollEl()}
                    shift={session.messageMutation() === "prepend"}
                    cache={measurement()}
                    overscan={2}
                    itemSize={260}
                  >
                    {(row, index) => (
                      <TranscriptRowView
                        row={row}
                        index={index()}
                        onForkMessage={props.onForkMessage}
                        activeSearch={activeKey() === row.key}
                      />
                    )}
                  </Virtualizer>
                </Show>
                <For each={tail()}>
                  {(key) => (
                    <TranscriptRowView
                      row={lookup().get(key)!}
                      onForkMessage={props.onForkMessage}
                      activeSearch={activeKey() === key}
                    />
                  )}
                </For>
              </div>
            </Show>
            <Show when={revert()}>
              <RevertBanner />
            </Show>
            <For each={partition().queued}>
              {(row) => <TranscriptRowView row={row} activeSearch={activeKey() === row.key} />}
            </For>
            <WorkingIndicator />
            <TurnOutcome />
            <For each={props.questions?.()}>{(req) => <QuestionDock request={req} />}</For>
            <For each={props.suggestions?.()}>{(req) => <SuggestBar request={req} />}</For>
          </Show>
        </div>
      </div>

      <Show when={autoScroll.userScrolled()}>
        <button
          class="scroll-to-bottom-button"
          onClick={() => autoScroll.resume()}
          aria-label={language.t("session.messages.scrollToBottom")}
        >
          <Icon name="arrow-down-to-line" />
        </button>
      </Show>
    </div>
  )
}
