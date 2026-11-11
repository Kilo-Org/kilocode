// The v2 transcript: a virtualized, turn-based list with load-earlier, the last
// live turn as a direct tail, queued prompts outside the virtual window and
// scroll-to-bottom.
import type { FormInfo, SessionInboxUser } from "@opencode/client"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import type { ToolActions, UserMessagePending } from "@kilocode/kilo-ui/message-part"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { type Component, createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import { KiloNotifications } from "../components/chat/KiloNotifications"
import { useLanguage } from "../context/language"
import { useNotificationsOptional } from "../context/notifications"
import { useVSCode } from "../context/vscode"
import { onTimelineHighlight, type TimelineHighlight } from "../utils/timeline/highlight"
import { partKey } from "../utils/timeline/timeline-parts"
import { useV2 } from "./client"
import { instructionFilesByRead } from "./instruction-files"
import { QuestionDock } from "./question"
import type { Selection } from "./selectors"
import { sessionStarting } from "./session-loading"
import {
  anchorOffset,
  handedRows,
  partitionTranscript,
  retainTurn,
  shiftedScroll,
  transcriptRows,
  type TranscriptHold,
  type TranscriptPartition,
  type TranscriptRow,
} from "./transcript"
import {
  getMeasurement,
  getScroll,
  layoutFingerprint,
  resolveAnchor,
  rowFingerprint,
  setMeasurement,
  setScroll,
} from "./transcript-cache"
import { createRowHandoff } from "./transcript-row-handoff"
import { TranscriptRowView } from "./transcript-row"
import { useTranscriptSearch } from "./transcript-search"
import { applyTranscriptHighlights, clearTranscriptHighlights } from "./transcript-search-highlight"
import { buildSearchPattern, searchMatches } from "./transcript-search-match"
import { UserMessage } from "./user"
import { Welcome } from "./welcome"
import { PromptRail } from "./prompt-rail"
import { capacity, historyAction, promptItems, railEntries, type PromptRailItem } from "./prompt-rail-data"

/**
 * Container for Virtua rows. Virtua sizes it from cached row heights and places
 * rows absolutely inside it. A row that mounts taller than its cached height
 * overflows the container and grows the scroller. The bottom pin then scrolls
 * the row out of range, and the row unmounts before Virtua measures it. The
 * scroller shrinks, the row comes back into range, and this repeats every
 * frame. The container clips vertically (see chat-layout.css), so only
 * measured sizes set the scroll height.
 */
const VirtualBox: Component<{
  ref?: HTMLDivElement | ((el: HTMLDivElement) => void)
  style?: JSX.CSSProperties
  children?: JSX.Element
}> = (box) => (
  <div ref={box.ref} style={box.style} data-slot="message-list-virtual">
    {box.children}
  </div>
)

function sameKeys(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false
  }
  return true
}

export function MessageList(props: {
  session?: string
  /** The session whose first transcript page is in flight, from the view that starts the request. */
  starting?: string
  actions?: ToolActions
  onSelectSession: (id: string) => void
  onShowHistory: () => void
  /** Forks the session before a user message, when the surface can fork. */
  onForkMessage?: (sessionID: string, messageID: string) => void
  /** Replaces the welcome screen of an empty session, for example with the Agent Manager introduction. */
  empty?: () => JSX.Element
  /** Selects the model a notification offers; without it the header shows no model action. */
  selection?: Selection
  /** Receives the handler the session dock calls to scroll to the bottom. */
  onScrollToBottomReady?: (handler: (() => void) | undefined) => void
  /** Opens the files changed by one turn. */
  onViewTurnChanges?: (sessionID: string, turnID: string) => void
  /** The delivery state and controls of a user message the server has not handed to the model yet. */
  pending?: (messageID: string) => UserMessagePending | undefined
  /** The question awaiting an answer, appended to the transcript so it scrolls with it as in v1. */
  question?: () => FormInfo | undefined
}) {
  const v2 = useV2()
  const vscode = useVSCode()
  const language = useLanguage()
  const notifications = useNotificationsOptional()
  const [highlight, setHighlight] = createSignal<TimelineHighlight>()
  onCleanup(onTimelineHighlight(setHighlight))

  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>()
  const [layout, setLayout] = createSignal("")
  // Transcript height, kept reactive so the prompt rail re-caps on resize.
  const [height, setHeight] = createSignal(0)
  const [pendingJump, setPendingJump] = createSignal<{ session: string; key: string }>()
  const [pendingRestore, setPendingRestore] = createSignal<string>()

  // createData already puts pending user input into the message list. Only queued
  // input waits for the end of the turn, so it moves below the transcript.
  const queued = () => {
    const id = props.session
    if (!id) return []
    return v2.data.session.pending
      .list(id)
      .flatMap((item): SessionInboxUser[] => (item.type === "user" && item.delivery === "queue" ? [item] : []))
  }
  const messages = () => {
    const all = props.session ? v2.data.session.message.list(props.session) : []
    const ids = new Set(queued().map((item) => item.id))
    return ids.size === 0 ? all : all.filter((message) => !ids.has(message.id))
  }
  const instructionFiles = createMemo(() => instructionFilesByRead(messages(), v2.directory))
  const working = () => !!props.session && v2.data.session.status(props.session) === "running"
  const loadingOlder = () => !!props.session && v2.data.session.message.loading(props.session)
  // The server always returns a next cursor, so a page shorter than the limit is what proves the start is loaded.
  const more = () =>
    !!props.session &&
    v2.data.session.message.more(props.session) &&
    !v2.data.session.message.startLoaded(props.session)
  const empty = () => !props.session || (messages().length === 0 && queued().length === 0)
  // The open session shows its loader instead of the welcome screen until the first transcript page lands.
  const starting = () =>
    sessionStarting({
      session: props.session,
      loading: props.starting,
      messages: messages().length,
      queued: queued().length,
    })
  const autoScroll = createAutoScroll({ working })
  props.onScrollToBottomReady?.(() => autoScroll.resume())
  onCleanup(() => props.onScrollToBottomReady?.(undefined))

  const rows = createMemo<TranscriptRow[]>((previous) => transcriptRows(messages(), previous))
  // A run that waits on a permission reports idle while its last step can still
  // change, so an unfinished last step also keeps its turn live.
  const activeTurn = () => {
    const last = messages().at(-1)
    const live = working() || (last?.type === "assistant" && last.time.completed === undefined)
    return live ? rows().at(-1)?.turn : undefined
  }
  const held = createMemo<TranscriptHold | undefined>((previous) =>
    retainTurn(previous, props.session, activeTurn(), autoScroll.userScrolled()),
  )
  const direct = createMemo(() => {
    const turns = new Set<string>()
    const hold = held()
    if (hold && hold.session === props.session) turns.add(hold.turn)
    const active = activeTurn()
    if (active) turns.add(active)
    return turns
  })
  const partition = createMemo<TranscriptPartition>((previous) =>
    partitionTranscript(rows(), queued(), direct(), previous),
  )
  const virtualKeys = createMemo(() => partition().virtualKeys, undefined, { equals: sameKeys })
  const directKeys = createMemo(() => partition().directKeys, undefined, { equals: sameKeys })
  const lookup = createMemo(() => new Map(rows().map((row) => [row.key, row])))
  // A fork keeps the messages before the chosen one, so a fork at the first user message is an empty session.
  // Only a transcript without older pages proves which user message is the first. A session created in this view
  // has no history cursor, and a fetched one reports when its loaded page reaches the start.
  const firstUser = createMemo(() =>
    props.session &&
    (!v2.data.session.message.more(props.session) || v2.data.session.message.startLoaded(props.session))
      ? rows().find((row) => row.type === "user")?.message.id
      : undefined,
  )
  const indexes = createMemo(() => new Map(virtualKeys().map((key, index) => [key, index])))
  const fingerprint = createMemo(() => rowFingerprint(virtualKeys()))
  // Virtua keeps the viewport on the same rows only when it knows that rows
  // were added before them. Rows handed over at the end must not shift it.
  const shift = createMemo<{ keys: readonly string[]; value: boolean }>((previous) => {
    const keys = virtualKeys()
    const first = previous?.keys[0]
    const value = !!first && keys.length > (previous?.keys.length ?? 0) && keys.indexOf(first) > 0
    return { keys, value }
  })
  // Virtua keeps measured sizes by index, not by key. Give each session its own
  // instance so rows never inherit another session's sizes.
  const instance = () => (scrollEl() && virtualKeys().length > 0 ? props.session : undefined)

  const measurement = createMemo(() => {
    const id = props.session
    const token = layout()
    if (!id || !token || virtualKeys().length === 0) return undefined
    return getMeasurement(id, fingerprint(), token)
  })

  let active = { session: props.session, keys: [] as readonly string[], fingerprint: rowFingerprint([]) }
  createEffect(() => {
    const id = props.session
    if (!id || loadingOlder()) return
    active = { session: id, keys: virtualKeys(), fingerprint: fingerprint() }
  })

  const save = (id: string | undefined, handle?: VirtualizerHandle, saved = active) => {
    const el = scrollEl()
    if (!id || !el || saved.session !== id) return
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
    // `scrollToIndex` adds the start margin again on restore.
    setScroll(id, {
      type: "anchor",
      key,
      offset: anchorOffset(handle.scrollOffset, startMargin(), handle.getItemOffset(index)),
    })
  }

  createEffect(
    on(
      () => props.session,
      (id, previous) => {
        save(previous)
        active = { session: id, keys: [], fingerprint: rowFingerprint([]) }
        setPendingRestore(id)
      },
    ),
  )

  createEffect(() => {
    const id = pendingRestore()
    if (!id) return
    if (loadingOlder()) return
    if (messages().length === 0) return
    requestAnimationFrame(() => {
      if (pendingRestore() !== id) return
      if (!scrollEl()?.isConnected) return
      const handle = virtualizer()
      const state = getScroll(id)
      const anchor = resolveAnchor(state, virtualKeys())
      if (handle && state?.type === "anchor" && anchor) {
        handle.scrollToIndex(anchor.index, { offset: anchor.offset })
        autoScroll.pause()
        // Virtua applies the scroll in a later frame. Page history only from
        // the restored position.
        requestAnimationFrame(maybeLoadOlder)
      } else {
        autoScroll.forceScrollToBottom()
      }
      setPendingRestore(undefined)
    })
  })

  onCleanup(() => save(props.session))

  // Rows handed from the direct tail enter Virtua at the estimated size, so a
  // tall turn can fall outside Virtua's range and remount. Keep them mounted in
  // the same update so the handoff keeps their DOM, then release them one frame
  // after they are measured.
  const handed = createMemo<{ direct: readonly string[]; moved: readonly string[] }>((previous) => {
    const map = indexes()
    return { direct: directKeys(), moved: handedRows(previous?.direct, map) }
  })
  const [released, setReleased] = createSignal<readonly string[]>()
  const keepMounted = createMemo(() => {
    const moved = handed().moved
    if (moved.length === 0 || released() === moved) return undefined
    const map = indexes()
    return moved.flatMap((key) => map.get(key) ?? [])
  })

  // A handed row is measured only by Virtua's ResizeObserver, one frame later.
  // The bottom pin follows the estimated layout until then, so one frame paints
  // the transcript below the bottom. Measure the handed rows in the same task
  // and re-pin before anything is painted.
  createEffect(
    on(
      () => ({ session: props.session, keys: virtualKeys() }),
      (now, previous) => {
        if (!previous || previous.session !== now.session) return
        if (now.keys.length <= previous.keys.length || now.keys.at(-1) === previous.keys.at(-1)) return
        const moved = handed().moved
        queueMicrotask(() => {
          const handle = virtualizer()
          if (!handle) return
          handle.measure()
          autoScroll.scrollToBottom()
          requestAnimationFrame(() => setReleased(moved))
        })
      },
    ),
  )

  // A task-timeline bar click scrolls to the row that contains its part. Rows
  // outside the virtual window resolve through the virtualizer index.
  const jump = (key: string) => {
    autoScroll.pause()
    const index = indexes().get(key)
    if (index !== undefined) {
      const handle = virtualizer()
      if (handle) {
        setPendingJump(undefined)
        handle.scrollToIndex(index, { align: "start" })
        return
      }
    }
    const el = scrollEl()
    const target = el?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`)
    if (el && target) {
      setPendingJump(undefined)
      el.scrollBy({ top: target.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientTop })
      return
    }
    if (props.session) setPendingJump({ session: props.session, key })
  }

  createEffect(() => {
    const target = pendingJump()
    if (!target) return
    if (!scrollEl()?.isConnected) return
    if (target.session !== props.session) {
      setPendingJump(undefined)
      return
    }
    const index = indexes().get(target.key)
    const handle = virtualizer()
    if (index !== undefined && handle) {
      setPendingJump(undefined)
      autoScroll.pause()
      handle.scrollToIndex(index, { align: "start" })
      return
    }
    const el = scrollEl()
    const row = el?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(target.key)}"]`)
    if (!el || !row) return
    setPendingJump(undefined)
    autoScroll.pause()
    el.scrollBy({ top: row.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientTop })
  })

  const search = useTranscriptSearch()
  // A failed history load leaves the cursor untouched, so the loading effect
  // would retry the whole remaining history on every run. Stop retrying until
  // the query, the session or the open state changes.
  createEffect(
    on(
      () => [props.session, search.active(), search.query()] as const,
      ([session, active, query], previous) => {
        if (!previous || previous[0] !== session || (active && !previous[1]) || previous[2] !== query)
          search.setHistoryFailed(false)
      },
      { defer: true },
    ),
  )

  const pattern = createMemo(() => {
    if (!search.active()) return undefined
    return buildSearchPattern(search.query(), search.matchCase(), search.wholeWord(), search.regex())
  })

  // An invalid regex (e.g. an unbalanced group) compiles to `undefined`, which
  // otherwise looks identical to "no matches" — surface it explicitly so the
  // search bar can show a real error instead.
  createEffect(() => {
    search.setInvalid(search.active() && !!search.query() && search.regex() && !pattern())
  })

  // The session only loads its most recent page up front, so the matches only
  // ever see the loaded rows. While a query is active, load the rest of the
  // history: a search that silently skipped older messages would undermine
  // the main "find something in a long session" use case, and a partial count
  // could mislead. `searchingHistory` keeps the bar on "Searching earlier
  // messages…" until the whole history has actually been searched.
  createEffect(() => {
    const id = props.session
    const searching =
      search.active() &&
      !!search.query() &&
      !!id &&
      !search.historyFailed() &&
      v2.data.session.message.more(id) &&
      !v2.data.session.message.startLoaded(id)
    search.setSearchingHistory(searching)
    if (!searching || !id || v2.data.session.message.loading(id)) return
    void v2.data.session.message.loadMore(id, { all: true }).catch((error: unknown) => {
      search.setHistoryFailed(true)
      v2.report(error)
    })
  })

  const matches = createMemo(() => searchMatches(rows(), pattern()))

  createEffect(
    on(matches, (list) => {
      search.setCount(list.length)
      if (list.length === 0) {
        search.setIndex(0)
        return
      }
      if (search.index() >= list.length) search.setIndex(list.length - 1)
    }),
  )

  // Jump straight to the first match as the user types or toggles an option,
  // instead of leaving them to press Enter or an arrow just to see where the
  // current query landed.
  createEffect(
    on(
      () => [search.query(), search.matchCase(), search.wholeWord(), search.regex()],
      () => {
        search.setIndex(0)
        search.requestJump()
      },
    ),
  )

  // Closing or switching to another session leaves a query bound to a
  // transcript that is no longer displayed if left untouched, so reset the
  // whole widget. `defer: true` skips the initial run so mounting does not
  // reset a session that was never searched.
  createEffect(
    on(
      () => props.session,
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

  const activeKey = createMemo(() => matches()[search.index()]?.key)
  const activeMatch = createMemo(() => matches()[search.index()])

  // Maps a row key to the part ids the data model could attribute matches to
  // there. A row with no entry has zero data-level matches, so the highlighter
  // scans nothing in it; a row with an entry always has a real match and falls
  // back to the whole row when its part ids resolve to no mounted element.
  const matchedPartsByRow = createMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const match of matches()) {
      const set = map.get(match.key) ?? new Set<string>()
      if (match.partId) set.add(match.partId)
      map.set(match.key, set)
    }
    return map
  })

  // Highlights every rendered occurrence of the query via the CSS Custom
  // Highlight API, and returns the precise Range of the current occurrence so
  // navigation can judge whether it needs to scroll at all (several
  // occurrences can share one message).
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
    // Only nudge the scroll position when the match is not already comfortably
    // placed. Re-centering on every step (even when the match is already
    // visible) reads as constant, distracting jumping when several occurrences
    // share one message.
    const rect = range.getClientRects()[0]
    if (!rect) return
    const box = el.getBoundingClientRect()
    const fullyVisible = rect.top >= box.top && rect.bottom <= box.bottom
    // The comfort band covers the middle 70% of the viewport, wide enough that
    // most steps between nearby matches do not scroll at all, while still
    // recentering before a match gets uncomfortably close to the edge.
    const comfortMargin = box.height * 0.35
    const centered = Math.abs(rect.top + rect.height / 2 - (box.top + box.height / 2)) <= comfortMargin
    if (fullyVisible && centered) return
    el.scrollBy({ top: rect.top + rect.height / 2 - box.top - el.clientTop - el.clientHeight / 2 })
  }

  // Two frames of margin so the virtualizer has settled the DOM for the new
  // scroll position before it is scanned for the precise occurrence to
  // center. Both frame ids are tracked so cleanup can cancel whichever leg of
  // the chain has not fired yet.
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
        const match = matches()[search.index()]
        if (!match) return
        autoScroll.pause()
        pendingCenter = true
        const el = scrollEl()
        const mounted = el?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(match.key)}"]`)
        // Only force the coarse row-level scroll when the row is virtualized
        // out. A mounted row defers entirely to the precise per-occurrence
        // check in paintHighlights, which only scrolls when the exact match
        // actually needs it.
        if (!mounted) {
          const index = indexes().get(match.key)
          if (index !== undefined) virtualizer()?.scrollToIndex(index, { align: "center" })
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

  const onScrollToMessage = (event: Event) => {
    const detail = (event as CustomEvent<{ id: string; partId?: string }>).detail
    if (!detail?.id) return
    const matches = rows().flatMap((row) => (row.type === "assistant" && row.message.id === detail.id ? [row] : []))
    const row =
      matches.find((candidate) =>
        detail.partId
          ? candidate.parts.some(
              (part, offset) => partKey(candidate.message.id, part, candidate.start + offset) === detail.partId,
            )
          : false,
      ) ?? matches[0]
    if (!row) return
    jump(row.key)
  }
  window.addEventListener("scrollToMessage", onScrollToMessage)
  onCleanup(() => window.removeEventListener("scrollToMessage", onScrollToMessage))

  const loadOlder = () => {
    const id = props.session
    if (!id || loadingOlder()) return
    void v2.data.session.message.loadMore(id).catch(v2.report)
  }

  // Virtua measures row offsets from the top of the scroller, but the rows start
  // below the history slot. Pass that offset as the start margin. When it
  // changes, for example when the last page loads and the slot goes away, move
  // the scroll position by the same amount so the rows the user reads stay put.
  const history = () => more() || loadingOlder()
  const [startMargin, setStartMargin] = createSignal(0)
  let turnsEl: HTMLDivElement | undefined
  const syncStart = () => {
    const el = scrollEl()
    if (!el || !turnsEl) return
    const next = Math.round(el.scrollTop + turnsEl.getBoundingClientRect().top - el.getBoundingClientRect().top)
    if (next === startMargin()) return
    if (autoScroll.userScrolled()) el.scrollTop = shiftedScroll(el.scrollTop, startMargin(), next)
    setStartMargin(next)
  }
  createEffect(on([history, () => props.session], syncStart))

  // A session that opens is at offset 0 until its rows mount and the restore
  // runs. That position must not page its history.
  const maybeLoadOlder = () => {
    const el = scrollEl()
    if (!el || pendingRestore() || el.scrollTop > 600 || !more()) return
    loadOlder()
  }

  // Prompt navigator: one tick per user prompt, positioned against the
  // transcript edge, opening a card of prompt and answer previews.
  const railItems = createMemo(() => promptItems(rows(), partition().queued))
  // Until the transcript is measured there is no height to cap against, and
  // rendering every prompt would spill ticks past the rail on long sessions.
  const entries = createMemo(() => railEntries(railItems(), capacity(height()), more()))
  const [railTurn, setRailTurn] = createSignal<string>()
  const railActiveKey = createMemo(() => railItems().find((item) => item.turn === railTurn())?.key)
  // Older prompts are prepended inside the open card. Virtua keeps the visible
  // row still only when it knows rows were added before it.
  const prepending = createMemo<{ keys: readonly string[]; value: boolean }>((previous) => {
    const keys = railItems().map((item) => item.key)
    const first = previous?.keys[0]
    return {
      keys,
      value: !!first && keys.length > (previous?.keys.length ?? 0) && keys.indexOf(first) > 0,
    }
  })

  // Jumping to the first prompt pages the whole history in, deliberately and
  // progressively: each completed prepend advances the cursor, while hover and
  // opening the card remain free of network work. Stop if a request makes no
  // progress so a backend failure cannot become a retry loop.
  const [seek, setSeek] = createSignal<{ session: string; count: number }>()
  let paging = false
  const firstPrompt = () => {
    const item = railItems()[0]
    if (!more()) {
      if (item) jump(item.key)
      return
    }
    const id = props.session
    if (!id || loadingOlder()) return
    const count = messages().length
    // Start the request before recording the seek: a signal write can flush
    // this effect before the call returns, and it must observe the load.
    loadOlder()
    setSeek({ session: id, count })
  }
  createEffect(() => {
    const loading = loadingOlder()
    const target = seek()
    if (!target) {
      paging = loading
      return
    }
    if (target.session !== props.session) {
      paging = false
      setSeek(undefined)
      return
    }
    if (loading) {
      paging = true
      return
    }
    // The load never started (no cursor left, or a failure cleared it), so
    // treat this as the end instead of leaving the card seeking forever.
    if (!paging) {
      setSeek(undefined)
      const item = railItems()[0]
      if (item) jump(item.key)
      return
    }
    paging = false
    const count = messages().length
    const action = historyAction(target.count, count, more())
    const item = railItems()[0]
    if (action === "load") {
      loadOlder()
      setSeek({ session: target.session, count })
      return
    }
    setSeek(undefined)
    if (item) jump(item.key)
  })

  // The active tick follows the turn at the top of the transcript, derived from
  // the virtualizer offset. When the rows do not fill the transcript, the newest
  // prompt is the one in view.
  const trackActive = () => {
    const list = railItems()
    if (list.length === 0) return setRailTurn(undefined)
    const handle = virtualizer()
    const offset = handle?.scrollOffset
    if (handle && offset !== undefined && offset > 1) {
      const row = lookup().get(virtualKeys()[handle.findItemIndex(offset)] ?? "")
      if (row) return setRailTurn(row.turn)
    }
    const el = scrollEl()
    if (handle && el && el.scrollHeight > el.clientHeight + 1) {
      const row = lookup().get(virtualKeys()[0] ?? "")
      if (row) return setRailTurn(row.turn)
    }
    setRailTurn(list.at(-1)?.turn)
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
    railItems()
    partition()
    // The virtualizer mounts after the first pass; measure again once it exists.
    virtualizer()
    scheduleActive()
  })

  // A synthetic scroll only lets Virtua read the offset after a remount. It
  // must not page history.
  let syncing = false
  const handleScroll = () => {
    autoScroll.handleScroll()
    if (!syncing) maybeLoadOlder()
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
  const setScrollRef = (el: HTMLDivElement | undefined) => {
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

  const handoff = createRowHandoff()
  const Row: Component<{ id: string }> = (entry) => {
    const key = entry.id
    const initial: TranscriptRow = lookup().get(key)!
    return handoff(`${props.session}:${key}`, () => {
      // A removed row can outlive its map entry until the handoff cleanup.
      const row = createMemo<TranscriptRow>((previous) => lookup().get(key) ?? previous, initial)
      return (
        <TranscriptRowView
          row={row()}
          session={props.session ?? ""}
          actions={props.actions}
          instructionFiles={(partID) => instructionFiles().get(partID)}
          highlight={() => highlight()}
          searchActive={activeKey() === key}
          onViewTurnChanges={props.onViewTurnChanges}
          onForkMessage={row().message.id === firstUser() ? undefined : props.onForkMessage}
          onSelectSession={props.onSelectSession}
          pending={props.pending}
        />
      ) as HTMLElement
    })
  }

  // The Agent Manager and other editor surfaces have no sidebar edge signal.
  // Keep their rail on the physical right, even in RTL.
  const railSide = () => vscode.sidebarSide() ?? "right"

  return (
    <div class="message-list-container" data-prompt-rail={entries().length >= 2 ? railSide() : undefined}>
      <Show when={!props.empty && empty() ? notifications : undefined}>
        {(value) => (
          <Show when={props.selection}>
            {(selection) => (
              <div class="welcome-header" data-slot="welcome-header">
                <KiloNotifications notifications={value()} selection={selection()} />
              </div>
            )}
          </Show>
        )}
      </Show>
      <div
        ref={setScrollRef}
        onScroll={handleScroll}
        class="message-list"
        data-slot="message-list"
        tabIndex={-1}
        role="log"
        aria-live="polite"
      >
        <div
          ref={autoScroll.contentRef}
          data-slot="message-list-content"
          // A pending question keeps the transcript lane: the empty layout centers its children in a row, which
          // would put the dock beside the welcome screen and drop its max-width and centering.
          class={
            empty() && !starting() && !props.question?.() ? "message-list-content-empty" : "message-list-content"
          }
        >
          <Show when={starting()}>
            <div class="message-list-loading" role="status">
              <Spinner />
              <span>{language.t("session.messages.loading")}</span>
            </div>
          </Show>
          <Show when={empty() && !starting()}>
            {props.empty ? (
              props.empty()
            ) : (
              <Welcome onSelectSession={props.onSelectSession} onShowHistory={props.onShowHistory} />
            )}
          </Show>
          <Show when={!empty() && props.session}>
            {(id) => (
              <>
                <Show when={history()}>
                  <div class="message-list-history">
                    <Show
                      when={loadingOlder()}
                      fallback={
                        <button class="message-list-load-older" onClick={loadOlder}>
                          {language.t("session.messages.loadEarlier")}
                        </button>
                      }
                    >
                      <div class="message-list-page-loader" role="status">
                        <Spinner />
                        <span>{language.t("session.messages.loadingEarlier")}</span>
                      </div>
                    </Show>
                  </div>
                </Show>
                <div
                  ref={(el) => {
                    turnsEl = el
                    queueMicrotask(syncStart)
                  }}
                  class="message-list-turns"
                  data-loaded-messages={messages().length}
                  data-row-count={virtualKeys().length}
                  data-direct-count={directKeys().length}
                  data-queued-count={queued().length}
                >
                  <Show when={instance()} keyed>
                    {(session) => {
                      let handle: VirtualizerHandle | undefined
                      onCleanup(() => save(session, handle))
                      const ref = (next?: VirtualizerHandle) => {
                        if (next) handle = next
                        setVirtualizer(next)
                        const el = scrollEl()
                        if (!next || !el) return
                        // A new instance starts at offset 0. If the scroller is
                        // already elsewhere and does not move again, no scroll
                        // event syncs it, so report the position once.
                        queueMicrotask(() => {
                          if (virtualizer() !== next || Math.abs(el.scrollTop - next.scrollOffset) < 1) return
                          syncing = true
                          el.dispatchEvent(new Event("scroll"))
                          syncing = false
                        })
                      }
                      return (
                        <Virtualizer
                          ref={ref}
                          as={VirtualBox}
                          data={virtualKeys()}
                          scrollRef={scrollEl()}
                          shift={shift().value}
                          startMargin={startMargin()}
                          keepMounted={keepMounted()}
                          cache={measurement()}
                          bufferSize={520}
                          itemSize={260}
                        >
                          {(key) => <Row id={key} />}
                        </Virtualizer>
                      )
                    }}
                  </Show>
                  <For each={directKeys()}>{(key) => <Row id={key} />}</For>
                </div>
                <For each={partition().queued}>
                  {(row) => (
                    <div class="message-list-queued" data-queued="true" data-row-key={row.key}>
                      <UserMessage
                        message={{ ...row.item.payload, id: row.item.id, type: "user", time: row.item.time }}
                        onSelectSession={props.onSelectSession}
                        pending={props.pending?.(row.item.id)}
                      />
                    </div>
                  )}
                </For>
              </>
            )}
          </Show>
          {/* Outside the loaded-transcript gate: a pending question must stay answerable while the first page
              loads, and the server only asks one once the session has messages. */}
          <Show when={props.question?.()} keyed>
            {(form) => <QuestionDock form={form} />}
          </Show>
        </div>
      </div>
      <PromptRail
        side={railSide()}
        entries={entries}
        items={railItems}
        active={railActiveKey}
        onSelect={(item: PromptRailItem) => jump(item.key)}
        onFirst={firstPrompt}
        onLatest={() => {
          const item = railItems().at(-1)
          if (item) jump(item.key)
        }}
        onLoadOlder={loadOlder}
        onWheel={(deltaY) => {
          const el = scrollEl()
          if (!el) return
          if (deltaY < 0 && el.scrollHeight - el.clientHeight > 1) autoScroll.pause()
          el.scrollTop += deltaY
        }}
        height={height}
        hasOlder={more}
        loadingOlder={loadingOlder}
        prepending={() => prepending().value}
        seeking={() => Boolean(seek())}
      />
      <Show when={!empty() && autoScroll.userScrolled()}>
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
