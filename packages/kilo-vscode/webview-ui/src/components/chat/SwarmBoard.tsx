/**
 * The shared agent board of a root session.
 *
 * The board belongs to the session, not to a run, so it outlives the
 * background agents that post on it. The agent map reads it in its Board
 * tab, and the dock's agent map button marks new posts.
 */

import {
  For,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  useContext,
  type Component,
  type ParentComponent,
} from "solid-js"
import { BoardMessage } from "@kilocode/kilo-ui/board-message"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { useBoardNavigation } from "@kilocode/kilo-ui/context/board-navigation"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import type { SessionBoard, SessionBoardLoadedMessage } from "../../types/messages"

type Probe = { requestID: string; sessionID: string; projectId?: string; scope: string; epoch?: number }

function merge(previous: SessionBoard | undefined, next: SessionBoard, before?: string) {
  if (!previous || !before) return next
  const known = new Set(previous.messages.map((item) => item.id))
  const added = next.messages.filter((item) => !known.has(item.id))
  return {
    ...next,
    revision: previous.revision,
    hasMore: next.hasMore && added.length > 0 && next.cursor !== before,
    messages: [...added, ...previous.messages],
  }
}

export function useSwarmBoard(props: { readonly?: boolean; projectId?: string }) {
  const session = useSession()
  const config = useConfig()
  const language = useLanguage()
  const vscode = useVSCode()
  const navigate = useBoardNavigation()
  const [board, setBoard] = createSignal<SessionBoard>()
  const [error, setError] = createSignal<string>()
  const [pending, setPending] = createSignal<Probe & { before?: string }>()
  // A one-post check runs on its own, so it never blocks or replaces a full load.
  const [peeking, setPeeking] = createSignal<Probe>()
  // The newest post, and the newest post the user has seen. The first load
  // of a view counts as seen, so a reload does not mark old posts as new.
  const [latest, setLatest] = createSignal<string>()
  const [seen, setSeen] = createSignal<string>()
  let fresh = true
  let jobs = ""
  // Bumped when a full load or a reset lands, so a late one-post check cannot
  // restore a board that a reset just cleared.
  let epoch = 0
  const present = () => !!board()?.messages.length
  const scope = createMemo(() => JSON.stringify([session.currentSessionID(), props.projectId]))
  const allowed = createMemo(() => {
    const current = session.currentSession()
    return (
      !!current &&
      !props.readonly &&
      !current.parentID &&
      current.id === session.currentSessionID() &&
      !current.id.startsWith("cloud:") &&
      (config.config().shared_agent_board ?? true)
    )
  })

  /** Loads the newest page, an older page with `before`, or resets the board at `revision`. */
  const request = (before?: string, revision?: number) => {
    const sessionID = session.currentSessionID()
    if (!sessionID || !allowed() || pending()) return
    const base = { sessionID, projectId: props.projectId, requestID: crypto.randomUUID() }
    setPending({ ...base, scope: scope(), before })
    setError(undefined)
    vscode.postMessage(
      revision === undefined
        ? { type: "requestSessionBoard", ...base, before, limit: 50 }
        : { type: "resetSessionBoard", ...base, revision },
    )
  }

  const peek = () => {
    const sessionID = session.currentSessionID()
    if (!sessionID || !allowed() || !vscode.active() || peeking()) return
    const base = { sessionID, projectId: props.projectId, requestID: crypto.randomUUID() }
    setPeeking({ ...base, scope: scope(), epoch })
    vscode.postMessage({ type: "requestSessionBoard", ...base, limit: 1 })
  }

  const check = () => {
    if (!present()) peek()
  }

  const note = (next: SessionBoard) => {
    const id = next.messages.at(-1)?.id
    setLatest(id)
    if (!fresh) return
    fresh = false
    setSeen(id)
  }

  const match = <T extends Probe>(expected: T | undefined, message: SessionBoardLoadedMessage): expected is T =>
    !!expected &&
    expected.scope === scope() &&
    expected.requestID === message.requestID &&
    expected.sessionID === message.sessionID &&
    (expected.projectId === undefined || expected.projectId === message.projectId)

  // A one-post check notes the newest post. It fills the board only while the
  // board is hidden, or when it finds the board empty.
  const probed = (message: SessionBoardLoadedMessage) => {
    const probe = peeking()
    if (!match(probe, message)) return false
    setPeeking(undefined)
    // A full load or a reset landed after this check, so its board is newer.
    if (probe.epoch !== epoch) return true
    const next = message.board
    if (message.error || !next || next.ownerSessionID !== probe.sessionID) return true
    note(next)
    if (!present() || !next.messages.length) setBoard(next)
    return true
  }

  onCleanup(
    vscode.onMessage((message) => {
      if (
        message.type === "backgroundJobsLoaded" &&
        message.sessionID === session.currentSessionID() &&
        !message.error
      ) {
        // Agents usually post right before they finish, so a changed job list
        // is when a known board checks for a new post.
        const next = message.jobs.map((job) => `${job.id}:${job.status}`).join()
        if (next !== jobs && present()) peek()
        else if (next !== jobs || message.jobs.some((job) => job.status === "running")) check()
        jobs = next
      }
      if (message.type === "sessionUpdated" && message.session.id === session.currentSessionID()) check()
      if (message.type !== "sessionBoardLoaded" || probed(message)) return
      const expected = pending()
      if (!match(expected, message)) return
      setPending(undefined)
      if (message.error || !message.board || message.board.ownerSessionID !== expected.sessionID) {
        setError(language.t("task.swarm.failed"))
        return
      }
      if (!expected.before) {
        note(message.board)
        epoch += 1
      }
      setBoard(merge(board(), message.board, expected.before))
    }),
  )
  createEffect(
    on(
      scope,
      () => {
        setBoard(undefined)
        setPending(undefined)
        setPeeking(undefined)
        setError(undefined)
        setLatest(undefined)
        setSeen(undefined)
        fresh = true
        jobs = ""
        check()
      },
      { defer: true },
    ),
  )

  createEffect(on([scope, allowed, vscode.active], check))

  const source: BoardSource = { board, pending, error, request: (before) => request(before) }

  return {
    /** The board has posts to show. */
    shown: () => allowed() && present(),
    /** The board can exist for this session, posts or not. */
    available: allowed,
    unread: () => !!latest() && latest() !== seen(),
    messages: () => board()?.messages ?? [],
    busy: () => !!pending(),
    load: () => request(),
    /** Clears every post. The caller confirms first. */
    reset: () => {
      const current = board()
      if (current) request(undefined, current.revision)
    },
    source,
    mark: () => setSeen(latest()),
    navigate: (id: string, title?: string) => navigate?.(id, title),
  }
}

export type SwarmBoardState = ReturnType<typeof useSwarmBoard>

/** What a board reader reads and pages through. */
interface BoardSource {
  board: () => SessionBoard | undefined
  pending: () => { before?: string } | undefined
  error: () => string | undefined
  request: (before?: string) => void
}

type BoardPost = SessionBoard["messages"][number]

/**
 * The board history, newest at the bottom. Scrolling up pages in older
 * posts and keeps the post under the pointer in place.
 */
export const BoardReader: Component<{
  source: BoardSource
  /** Keeps the view pinned to the newest post while true. */
  working: () => boolean
  /** Shows only the posts that pass. Paging continues until older posts run out. */
  filter?: (post: BoardPost) => boolean
  onAgent: (id: string, title?: string) => void
  controls?: (value: { resume: () => void }) => void
}> = (props) => {
  const language = useLanguage()
  const scroll = createAutoScroll({ working: props.working, overflowAnchor: "dynamic" })
  props.controls?.({ resume: () => scroll.resume() })
  let viewport: HTMLDivElement | undefined
  let resize: ResizeObserver | undefined
  let anchor: { element: HTMLElement; top: number } | undefined
  const posts = createMemo(() => {
    const list = props.source.board()?.messages ?? []
    return props.filter ? list.filter(props.filter) : list
  })
  const more = () => {
    const current = props.source.board()
    if (
      !props.working() ||
      !viewport ||
      viewport.scrollTop > 160 ||
      !current?.hasMore ||
      !current.cursor ||
      props.source.pending() ||
      props.source.error()
    )
      return
    const element = viewport.querySelector<HTMLElement>('[data-slot="board-message-body"]')
    if (scroll.userScrolled() && element)
      anchor = { element, top: element.getBoundingClientRect().top - viewport.getBoundingClientRect().top }
    props.source.request(current.cursor)
  }
  createEffect(
    on(
      () => props.source.board()?.messages,
      () => {
        const current = anchor
        anchor = undefined
        if (!current) return
        queueMicrotask(() => {
          if (!viewport?.isConnected || !current.element.isConnected) return
          viewport.scrollTop +=
            current.element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - current.top
        })
      },
    ),
  )
  onCleanup(() => resize?.disconnect())
  return (
    <div
      class="task-board-scroll"
      tabIndex={0}
      role="region"
      aria-label={language.t("task.swarm.title")}
      ref={(el) => {
        viewport = el
        scroll.scrollRef(el)
      }}
      onScroll={() => {
        scroll.handleScroll()
        if (anchor && props.source.pending()?.before && viewport) {
          anchor = scroll.userScrolled()
            ? {
                element: anchor.element,
                top: anchor.element.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
              }
            : undefined
        }
        more()
      }}
      onWheel={(event) => {
        if (event.deltaY < 0) {
          scroll.pause()
          more()
        }
      }}
      onKeyDown={(event) => {
        if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
          scroll.pause()
          more()
        }
      }}
    >
      <div
        class="task-board-list"
        data-component="board-messages"
        ref={(el) => {
          resize?.disconnect()
          if (!el) return
          scroll.contentRef(el)
          resize = new ResizeObserver(() => {
            if (viewport && viewport.scrollHeight <= viewport.clientHeight) more()
          })
          resize.observe(el)
        }}
      >
        <For each={posts()}>{(message) => <BoardMessage {...message} onSessionClick={props.onAgent} />}</For>
      </div>
    </div>
  )
}

const SwarmBoardContext = createContext<SwarmBoardState>()

/**
 * One board per chat view. The dock button and the agent map read the same
 * board, so a post read in the map clears the button's mark. A read-only view
 * keeps a board that stays empty, so the chat is not rebuilt when it turns
 * read-only.
 */
export const SwarmBoardProvider: ParentComponent<{ readonly?: boolean; projectId?: string }> = (props) => {
  const state = useSwarmBoard(props)
  return <SwarmBoardContext.Provider value={state}>{props.children}</SwarmBoardContext.Provider>
}

/** The chat view's board, if the surface has one. */
export function useSharedSwarmBoard() {
  return useContext(SwarmBoardContext)
}
