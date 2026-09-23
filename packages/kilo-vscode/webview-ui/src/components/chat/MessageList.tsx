/** @jsxImportSource solid-js */

/**
 * MessageList component
 * Scrollable turn-based message list with virtualization.
 * Shows recent sessions in the empty state for quick resumption.
 */

import {
  type Accessor,
  type Component,
  type JSX,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { WelcomeEmptyState } from "./WelcomeEmptyState"
import { TranscriptRowView } from "./TranscriptRow"
import { createRowHandoff } from "./transcript-row-handoff"
import { RevertBanner } from "./RevertBanner"
import { AccountSwitcher } from "../shared/AccountSwitcher"
import { KiloNotifications } from "./KiloNotifications"
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
  type TranscriptHold,
  type TranscriptRow,
} from "../../context/transcript-rows"
import { PromptRail } from "./PromptRail"
import { capacity, historyAction, promptItems, railEntries, type PromptRailItem } from "./prompt-rail"
import { onTimelineHighlight, type TimelineHighlight } from "../../utils/timeline/highlight"
import { escapeRegExp } from "../../utils/escape-regexp"
import { useTranscriptSearch, type SearchMatch } from "../../context/transcript-search"
import { applyTranscriptHighlights, clearTranscriptHighlights } from "./transcript-search-highlight"
import { rowSearchText, type SearchTextRange } from "./transcript-search-text"
import type { QuestionRequest, SuggestionRequest } from "../../types/messages"

interface MessageListProps {
  onSelectSession?: (id: string) => boolean | void
  isSessionOpen?: (id: string) => boolean
  onShowHistory?: () => void
  onForkMessage?: (sessionId: string, messageId: string) => void
  onEditMessage?: (sessionID: string, messageID: string) => void
  onScrollToBottomReady?: (handler: (() => void) | undefined) => void
  /** Non-tool question requests to render inline at the bottom of the message list */
  questions?: () => QuestionRequest[]
  /** Non-tool suggestion requests to render inline at the bottom of the message list */
  suggestions?: () => SuggestionRequest[]
  /** When true (subagent viewer), replace the welcome screen with an initializing indicator */
  readonly?: boolean
  /** Whether inline questions and suggestions are actionable on this surface. */
  interactivePrompts?: boolean
  queuedDisabled?: boolean
  editDisabled?: boolean
  /** Optionally replace the standard welcome content while the conversation is empty. */
  emptyState?: () => JSX.Element
  introduction?: boolean
  /** Announce transcript changes as a live log. Disable for multi-session surfaces with concurrent streams. */
  announce?: boolean
  sessionID?: Accessor<string | undefined>
}

export const MessageList: Component<MessageListProps> = (props) => {
  const session = useSession()
  const server = useServer()
  const vscode = useVSCode()
  const language = useLanguage()

  const autoScroll = createAutoScroll({
    working: () => session.status() !== "idle",
  })
  props.onScrollToBottomReady?.(() => autoScroll.resume())
  onCleanup(() => props.onScrollToBottomReady?.(undefined))
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
  // Transcript height, kept reactive so the prompt rail re-caps on resize.
  const [height, setHeight] = createSignal(0)

  const revert = () => session.revert() ?? undefined
  const turns = createMemo((prev: MessageTurn[] | undefined) =>
    stableMessageTurns(
      messageTurns(session.messages(), revert(), (msg) => session.getParts(msg.id)),
      prev,
    ),
  )
  const isEmpty = () => turns().length === 0 && !session.loading() && !revert()
  const introduction = createMemo(() => isEmpty() && !props.readonly && props.introduction)

  const activeUserID = createMemo(() =>
    getActiveUserMessageID(
      session.messages(),
      session.statusInfo(),
      (msg) => session.getParts(msg.id),
      session.submitting(),
    ),
  )
  const queuedIDs = createMemo(
    () =>
      new Set(
        queuedUserMessageIDs(
          session.messages(),
          session.statusInfo(),
          (msg) => session.getParts(msg.id),
          session.submitting(),
        ),
      ),
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

  function rangeAt(ranges: SearchTextRange[], index: number): SearchTextRange | undefined {
    return ranges.find((r) => index >= r.start && index < r.end)
  }

  function buildPattern(query: string, matchCase: boolean, wholeWord: boolean, regex: boolean): RegExp | undefined {
    if (!query) return undefined
    try {
      let pattern = query
      if (!regex) {
        pattern = escapeRegExp(query)
      }
      if (wholeWord) {
        // Unicode-aware boundary: plain `\b` only treats ASCII letters/
        // digits/underscore as "word" characters, so it silently breaks
        // whole-word matching for Cyrillic, Arabic, CJK, and other non-ASCII
        // text. `\p{L}`/`\p{M}`/`\p{N}` (letters/marks/numbers) require the
        // `u` flag, applied below for every pattern, not just this one.
        pattern = `(?<![\\p{L}\\p{M}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{M}\\p{N}_])`
      }
      return new RegExp(pattern, matchCase ? "gu" : "giu")
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

  // Sessions only load the most recent page (session.tsx's MESSAGE_PAGE_LIMIT)
  // up front; matches() only ever sees currently-loaded rows(). Without this,
  // an active search would silently miss everything in older, not-yet-loaded
  // history — undermining the main "find something in a long session" use
  // case, and a partial match count while some history remains unsearched
  // could actively mislead a user into the wrong conclusion. While a query
  // is active, keep requesting older pages until there aren't any more or
  // the search is no longer active; each completed load feeds back into
  // hasOlderMessages()/loadingOlderMessages(), both tracked here, so this
  // effect naturally re-fires and continues the chain without an explicit
  // loop. searchingHistory (surfaced to the widget) stays true for that
  // whole stretch, so "No results"/a final count aren't shown until the
  // entire session has actually been searched.
  //
  // Deliberately uncapped: an earlier revision capped this and offered an
  // opt-in to search further, but a possibly-incomplete count is worse than
  // the cost of loading a very long session's full history. Revisit with a
  // cap (or a lazy/incremental search strategy) in a follow-up if this
  // proves too slow/expensive in practice on very long sessions.
  createEffect(() => {
    const searching = search.active() && !!search.query() && session.hasOlderMessages()
    search.setSearchingHistory(searching)
    if (!searching || session.loadingOlderMessages()) return
    session.loadOlderMessages()
  })

  const matches = createMemo(() => {
    const p = pattern()
    if (!p) return []
    const list = rows()
    const result: SearchMatch[] = []
    for (const row of list) {
      const { text, ranges } = rowSearchText(row)
      p.lastIndex = 0
      let occurrence = 0
      let hit = p.exec(text)
      while (hit) {
        if (hit[0].length === 0) {
          p.lastIndex += 1
          hit = p.exec(text)
          continue
        }
        const range = rangeAt(ranges, hit.index)
        result.push({ key: row.key, occurrence, partId: range?.partId })
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
      () => {
        search.setIndex(0)
        // Jump straight to the first match as the user types/toggles an
        // option, instead of leaving them to press Enter/an arrow just to
        // see where the current query actually landed. `requestJump` is a
        // no-op when there are no matches (guarded in the jump effect).
        search.requestJump()
      },
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

  // Maps a row's key to the part ids the data model could attribute matches
  // to there. A row with NO entry here has zero data-level matches, so the
  // highlighter must scan nothing in it at all — otherwise unindexed text (a
  // static button label, a sibling part that didn't match) could get
  // highlighted despite never being counted. An entry always exists for
  // every row that has at least one match, and a match in a row with no
  // resolvable part scope (e.g. a user message, whose parts carry no
  // data-part-id marker) falls back to scanning the whole row.
  const matchedPartsByRow = createMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const match of matches()) {
      const set = map.get(match.key) ?? new Set<string>()
      if (match.partId) set.add(match.partId)
      map.set(match.key, set)
    }
    return map
  })

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
    const range = applyTranscriptHighlights(
      el,
      pattern(),
      active && { key: active.key, occurrence: active.occurrence },
      matchedPartsByRow(),
    )
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
    // Scroll only the transcript, not VS Code's outer webview container.
    el.scrollBy({ top: rect.top + rect.height / 2 - box.top - el.clientTop - el.clientHeight / 2 })
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
          const index = indexes().get(match.key)
          if (index !== undefined) {
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
  const lookup = createMemo(() => new Map(rows().map((row) => [row.key, row])))
  const keys = createMemo(() => partition().virtual.map((row) => row.key))
  // Virtua keys its items by identity. Row objects are rebuilt whenever turn
  // meta changes (live flag at completion, copy anchor), which would remount
  // every row of the turn at the 260px estimate and bounce the transcript.
  // Feed it the stable keys and resolve the row reactively, like the tail.
  const indexes = createMemo(() => new Map(keys().map((key, index) => [key, index])))
  const fingerprint = createMemo(() => rowFingerprint(keys()))

  // A row handed from the direct tail to Virtua (each new step of the same
  // turn moves the previous assistant message) mounts at the 260px estimate
  // until Virtua's ResizeObserver measures it. The auto-scroll pins to that
  // shorter layout, the correction lands in the same ResizeObserver pass, and
  // the follow-up pin is deferred to the next frame, so one frame paints with
  // the transcript sitting below the bottom. Measure the handed rows in the
  // same task and re-pin before anything is painted.
  createEffect(
    on(
      () => ({ sid: session.currentSessionID(), keys: keys() }),
      (now, prev) => {
        if (!prev || prev.sid !== now.sid) return
        if (now.keys.length <= prev.keys.length || now.keys.at(-1) === prev.keys.at(-1)) return
        queueMicrotask(() => {
          const handle = virtualizer()
          if (!handle) return
          handle.measure()
          autoScroll.scrollToBottom()
        })
      },
    ),
  )

  const [pending, setPending] = createSignal<{ sid: string; key: string }>()

  // Scrolls the transcript to a row by key. Virtualized rows jump through
  // the virtualizer; direct/live/queued rows are mounted, so they use
  // the transcript scroller. Pauses auto-follow first so the jump isn't snapped back.
  const jump = (key: string) => {
    autoScroll.pause()
    const index = indexes().get(key)
    if (index !== undefined) {
      const handle = virtualizer()
      if (handle) {
        setPending(undefined)
        handle.scrollToIndex(index, { align: "start" })
        return
      }
      const sid = session.currentSessionID()
      if (sid) setPending({ sid, key })
      return
    }
    const el = scrollEl()
    const target = el?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`)
    if (el && target) {
      setPending(undefined)
      el.scrollBy({ top: target.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientTop })
      return
    }
    const sid = session.currentSessionID()
    if (sid) setPending({ sid, key })
  }

  // Keep unresolved targets by stable row key. Virtual rows resolve once
  // Virtua installs its handle; direct/live rows resolve once Solid mounts
  // their DOM node.
  createEffect(() => {
    const target = pending()
    if (!target) return
    if (target.sid !== session.currentSessionID()) {
      setPending(undefined)
      return
    }
    const index = indexes().get(target.key)
    const handle = virtualizer()
    if (index !== undefined && handle) {
      setPending(undefined)
      autoScroll.pause()
      handle.scrollToIndex(index, { align: "start" })
      return
    }
    const el = scrollEl()
    const row = el?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(target.key)}"]`)
    if (!el || !row) return
    setPending(undefined)
    autoScroll.pause()
    el.scrollBy({ top: row.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientTop })
  })

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
    jump(row.key)
  }
  window.addEventListener("scrollToMessage", onScrollToMessage)
  onCleanup(() => window.removeEventListener("scrollToMessage", onScrollToMessage))

  // Prompt rail: one tick per user prompt, positioned to the left of the
  // readable lane, opening a card of prompt/answer previews on hover.
  const items = createMemo(() => promptItems(rows()))
  // Until the transcript is measured there is no height to cap against, and
  // rendering every prompt would spill ticks past the rail on long sessions.
  const entries = createMemo(() => railEntries(items(), capacity(height()), session.hasOlderMessages()))
  const [activeTurn, setActiveTurn] = createSignal<string>()
  const railActiveKey = createMemo(() => items().find((item) => item.turn === activeTurn())?.key)

  const [seek, setSeek] = createSignal<{ sid: string; count: number }>()
  let paging = false

  const first = () => {
    const item = items()[0]
    if (!session.hasOlderMessages()) {
      if (item) jump(item.key)
      return
    }
    const sid = session.currentSessionID()
    if (!sid || session.loadingOlderMessages()) return
    setSeek({ sid, count: session.messages().length })
    if (!session.loadOlderMessages()) setSeek(undefined)
  }

  // Loading the first prompt is deliberate and progressive: each completed
  // prepend advances the existing page cursor, while hover/open remains free
  // of network and full-history work. Stop if a request makes no progress so
  // backend failures cannot turn into a retry loop.
  createEffect(() => {
    const loading = session.loadingOlderMessages()
    const target = seek()
    if (!target) {
      paging = loading
      return
    }
    if (target.sid !== session.currentSessionID()) {
      paging = false
      setSeek(undefined)
      return
    }
    if (loading) {
      paging = true
      return
    }
    if (!paging) return
    paging = false
    const count = session.messages().length
    const action = historyAction(target.count, count, session.hasOlderMessages())
    if (action === "stop") {
      const item = items()[0]
      setSeek(undefined)
      if (item) jump(item.key)
      return
    }
    if (action === "load") {
      setSeek({ sid: target.sid, count })
      if (!session.loadOlderMessages()) setSeek(undefined)
      return
    }
    const item = items()[0]
    setSeek(undefined)
    if (item) jump(item.key)
  })

  const trackActive = () => {
    const list = items()
    if (list.length === 0) return setActiveTurn(undefined)
    const handle = virtualizer()
    const offset = handle?.scrollOffset
    if (handle && offset !== undefined && offset > 1) {
      const row = partition().virtual[handle.findItemIndex(offset)]
      if (row) return setActiveTurn(row.turn)
    }
    const el = scrollEl()
    if (handle && el && el.scrollHeight > el.clientHeight + 1) {
      const row = partition().virtual[0]
      if (row) return setActiveTurn(row.turn)
    }
    setActiveTurn(list.at(-1)?.turn)
  }
  let activeFrame: number | undefined
  const scheduleActive = () => {
    if (activeFrame !== undefined) return
    activeFrame = requestAnimationFrame(() => {
      activeFrame = undefined
      trackActive()
    })
  }
  onCleanup(() => {
    if (activeFrame !== undefined) cancelAnimationFrame(activeFrame)
  })
  // Re-derive the active turn whenever the transcript changes so the rail
  // reflects a newly started turn even before any scrolling happens.
  createEffect(() => {
    items()
    partition()
    scheduleActive()
  })

  // Highlights the part behind the currently hovered/focused timeline bar
  // (dispatched by TaskTimeline) so the two stay visually correlated.
  const [highlight, setHighlight] = createSignal<TimelineHighlight>()
  onCleanup(onTimelineHighlight(setHighlight))

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

  const save = (id: string | undefined, handle?: VirtualizerHandle, saved = active) => {
    const el = scrollEl()
    if (!id || !el || saved.id !== id) return
    const token = layout()
    if (handle && token && saved.keys.length > 0) {
      setMeasurement(id, saved.fingerprint, token, handle.cache)
    }
    if (!autoScroll.userScrolled()) {
      setScroll(id, { type: "bottom" })
      return
    }
    if (!handle || saved.keys.length === 0) return
    const index = handle.findItemIndex(handle.scrollOffset)
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
    scheduleActive()
    if (search.active()) scheduleHighlight()
  }

  let resize: ResizeObserver | undefined
  const refreshLayout = () => {
    const el = scrollEl()
    if (!el) return
    const style = getComputedStyle(el)
    setHeight(el.clientHeight)
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

  createEffect(() => {
    const el = scrollEl()
    autoScroll.scrollRef(introduction() ? undefined : el)
    if (introduction() && el) el.scrollTop = 0
  })

  const [pendingRestore, setPendingRestore] = createSignal<string>()

  createEffect(
    on(session.currentSessionID, (id, prev) => {
      save(prev)
      active = { id, keys: [], fingerprint: rowFingerprint([]) }
      setPendingRestore(id)
    }),
  )

  // Clicking Show on the session that is already selected leaves
  // currentSessionID untouched, so the effect above never re-arms. Arm the same
  // restore pass from the request itself; it resolves to a scroll-to-bottom.
  createEffect(
    on(session.scrollBottomID, (id) => {
      if (id && id === session.currentSessionID()) setPendingRestore(id)
    }),
  )

  createEffect(() => {
    const id = pendingRestore()
    if (!id || session.loading()) return
    turns().length
    requestAnimationFrame(() => {
      if (pendingRestore() !== id) return
      const el = scrollEl()
      if (!el) return
      if (session.consumeScrollBottom(id)) {
        autoScroll.forceScrollToBottom()
        setPendingRestore(undefined)
        return
      }
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

  onCleanup(() => save(session.currentSessionID()))

  const handoff = createRowHandoff()
  // Virtua keeps measured sizes by index, not by key. Give each session its
  // own instance so rows never inherit another session's sizes, which left
  // blank gaps above the last message until the user scrolled.
  const instance = () => (scrollEl() && partition().virtual.length > 0 ? session.currentSessionID() : undefined)
  const Row: Component<{ id: string }> = (entry) => {
    const key = entry.id
    const initial: TranscriptRow = lookup().get(key)!
    return handoff(`${initial.message.sessionID}:${key}`, () => {
      // A removed row can outlive its map entry until the handoff cleanup.
      const row = createMemo<TranscriptRow>((prev) => lookup().get(key) ?? prev, initial)
      return (
        <TranscriptRowView
          row={row()}
          index={indexes().get(key)}
          onSelectSession={props.onSelectSession}
          isSessionOpen={props.isSessionOpen}
          onForkMessage={props.onForkMessage}
          onEditMessage={props.onEditMessage}
          queuedDisabled={props.queuedDisabled}
          editDisabled={props.editDisabled}
          highlight={highlight}
          activeSearch={activeKey() === key}
          readonly={props.readonly}
          interactivePrompts={props.interactivePrompts}
        />
      ) as HTMLElement
    })
  }

  return (
    <div class="message-list-container" classList={{ "am-intro-layout": introduction() }}>
      <Show when={props.announce === false}>
        <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement()}
        </div>
      </Show>
      <Show when={isEmpty()}>
        <div class="welcome-header" data-slot="welcome-header">
          <AccountSwitcher class="account-switcher-welcome" />
          <Show when={!props.introduction || props.readonly}>
            <KiloNotifications sessionID={props.sessionID} />
          </Show>
        </div>
      </Show>
      <div
        ref={setScrollRef}
        onScroll={handleScroll}
        class="message-list"
        data-slot="message-list"
        role={props.announce === false ? undefined : "log"}
        aria-live={props.announce === false ? undefined : "polite"}
        aria-busy={props.announce === false && session.status() !== "idle" ? "true" : undefined}
      >
        <div
          ref={autoScroll.contentRef}
          data-slot="message-list-content"
          class={isEmpty() ? "message-list-content-empty" : "message-list-content"}
        >
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
                <Show when={instance()} keyed>
                  {(id) => {
                    let handle: VirtualizerHandle | undefined
                    // The old instance is gone before the switch effect runs,
                    // so persist its sizes and position from its own handle.
                    onCleanup(() => save(id, handle))
                    const ref = (next?: VirtualizerHandle) => {
                      if (next) handle = next
                      setVirtualizer(next)
                      const el = scrollEl()
                      if (!next || !el) return
                      // A new instance starts at offset 0. If the scroller is
                      // already elsewhere and does not move again, no scroll
                      // event would sync it, so report the position once.
                      queueMicrotask(() => {
                        if (virtualizer() !== next || Math.abs(el.scrollTop - next.scrollOffset) < 1) return
                        el.dispatchEvent(new Event("scroll"))
                      })
                    }
                    return (
                      <Virtualizer
                        ref={ref}
                        data={keys()}
                        scrollRef={scrollEl()}
                        shift={session.messageMutation() === "prepend"}
                        cache={measurement()}
                        bufferSize={520}
                        itemSize={260}
                      >
                        {(key) => <Row id={key} />}
                      </Virtualizer>
                    )
                  }}
                </Show>
                <For each={tail()}>{(key) => <Row id={key} />}</For>
              </div>
            </Show>
            <Show when={revert()}>
              <RevertBanner />
            </Show>
            <For each={partition().queued}>
              {(row) => (
                <TranscriptRowView
                  row={row}
                  onSelectSession={props.onSelectSession}
                  isSessionOpen={props.isSessionOpen}
                  onEditMessage={props.onEditMessage}
                  queuedDisabled={props.queuedDisabled}
                  editDisabled={props.editDisabled}
                  activeSearch={activeKey() === row.key}
                  readonly={props.readonly}
                  interactivePrompts={props.interactivePrompts}
                />
              )}
            </For>
            <TurnOutcome />
            <Show when={props.interactivePrompts !== false}>
              <For each={props.questions?.()}>{(req) => <QuestionDock request={req} />}</For>
              <For each={props.suggestions?.()}>{(req) => <SuggestBar request={req} />}</For>
            </Show>
          </Show>
        </div>
      </div>

      <PromptRail
        // Editor tabs and Agent Manager have no sidebar edge signal. Keep their rail on the physical right in RTL too.
        side={vscode.sidebarSide() ?? "right"}
        entries={entries}
        items={items}
        active={() => railActiveKey()}
        onSelect={(item: PromptRailItem) => jump(item.key)}
        onFirst={first}
        onLatest={() => {
          const item = items().at(-1)
          if (item) jump(item.key)
        }}
        onLoadOlder={() => session.loadOlderMessages()}
        onWheel={(deltaY: number) => {
          const el = scrollEl()
          if (!el) return
          if (deltaY < 0 && el.scrollHeight - el.clientHeight > 1) autoScroll.pause()
          el.scrollTop += deltaY
        }}
        height={height}
        hasOlder={session.hasOlderMessages}
        loadingOlder={session.loadingOlderMessages}
        prepending={() => session.messageMutation() === "prepend"}
        seeking={() => Boolean(seek())}
      />

      <Show when={!introduction() && autoScroll.userScrolled()}>
        <IconButton
          icon="arrow-down-to-line"
          variant="ghost"
          size="small"
          class="scroll-to-bottom-button"
          onClick={() => autoScroll.resume()}
          aria-label={language.t("session.messages.scrollToBottom")}
        />
      </Show>
    </div>
  )
}
