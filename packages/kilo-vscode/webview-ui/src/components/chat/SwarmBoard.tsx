/**
 * The shared agent board of a root session.
 *
 * The board belongs to the session, not to a run, so it outlives the
 * background agents that post on it. The dock shows its button next to the
 * agent stack while agents exist, and alone in the same place after they are
 * cleared or the view reloads. The button opens the latest posts. The full
 * board, with history and reset, opens in a dialog.
 */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type Component,
  type ComponentProps,
  type JSX,
} from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { BoardMessage } from "@kilocode/kilo-ui/board-message"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useBoardNavigation } from "@kilocode/kilo-ui/context/board-navigation"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import type { SessionBoard, SessionBoardLoadedMessage } from "../../types/messages"

/** Posts shown in the dock panel. Older posts are in the full board. */
const RECENT = 5

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
  const dialog = useDialog()
  const navigate = useBoardNavigation()
  const [open, setOpen] = createSignal(false)
  const [board, setBoard] = createSignal<SessionBoard>()
  const [error, setError] = createSignal<string>()
  const [pending, setPending] = createSignal<Probe & { before?: string; confirmation?: string }>()
  // A one-post check runs on its own, so it never blocks or replaces a full load.
  const [peeking, setPeeking] = createSignal<Probe>()
  // The newest post, and the newest post the user has seen. The first load
  // of a view counts as seen, so a reload does not mark old posts as new.
  const [latest, setLatest] = createSignal<string>()
  const [seen, setSeen] = createSignal<string>()
  // True only for the full board reader, not the reset confirmation.
  const [reading, setReading] = createSignal(false)
  let fresh = true
  let jobs = ""
  let layer: string | undefined
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

  const request = (
    before?: string,
    target?: { scope: string; sessionID: string; projectId?: string; revision: number },
  ) => {
    const sessionID = target?.sessionID ?? session.currentSessionID()
    if (!sessionID || !allowed() || pending() || (target && target.scope !== scope())) return
    const base = { sessionID, projectId: target?.projectId ?? props.projectId, requestID: crypto.randomUUID() }
    setPending({ ...base, scope: scope(), before, confirmation: target ? dialog.active?.id : undefined })
    setError(undefined)
    vscode.postMessage(
      target
        ? { type: "resetSessionBoard", ...base, revision: target.revision }
        : { type: "requestSessionBoard", ...base, before, limit: 50 },
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
      if (dialog.active?.id === expected.confirmation) dialog.close()
    }),
  )
  createEffect(
    on(
      scope,
      () => {
        setOpen(false)
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

  createEffect(() => {
    if (!allowed() || !present() || !vscode.active()) setOpen(false)
  })

  const mark = () => setSeen(latest())
  createEffect(() => {
    if (reading()) mark()
  })

  const show = (content: () => JSX.Element, read = false) => {
    const current = scope()
    const valid = () => current === scope() && allowed() && present() && vscode.active()
    void dialog
      .show(
        () => {
          setOpen(true)
          setReading(read)
          onCleanup(() => {
            setOpen(false)
            setReading(false)
          })
          createEffect(() => {
            const ready = valid()
            if (!ready && dialog.active?.id === layer) dialog.close()
          })
          return content()
        },
        () => setOpen(false),
      )
      .then(() => {
        layer = dialog.active?.id
        if (!valid()) dialog.close()
      })
  }
  onCleanup(() => {
    if (layer && dialog.active?.id === layer) dialog.close()
  })

  const reset = () => {
    const current = board()
    const sessionID = session.currentSessionID()
    if (!current || !sessionID || pending()) return
    const target = { scope: scope(), sessionID, projectId: props.projectId, revision: current.revision }
    setError(undefined)
    show(() => {
      return (
        <Dialog title={language.t("task.swarm.resetTitle")} fit>
          <div class="dialog-confirm-body">
            <p>{language.t("task.swarm.resetDescription")}</p>
            <Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
            <div class="dialog-confirm-actions">
              <Button variant="ghost" onClick={() => dialog.close()}>
                {language.t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={!!pending()}
                onClick={() => {
                  if (error()) return view()
                  request(undefined, target)
                }}
              >
                <Show when={pending()}>
                  <Spinner />
                </Show>
                {language.t(error() ? "task.swarm.refresh" : "task.swarm.reset")}
              </Button>
            </div>
          </div>
        </Dialog>
      )
    })
  }

  const openAgent = (id: string, title?: string) => {
    dialog.close()
    navigate?.(id, title)
  }

  const view = () => {
    request()
    show(() => {
      const scroll = createAutoScroll({ working: open, overflowAnchor: "dynamic" })
      let viewport: HTMLDivElement | undefined
      let resize: ResizeObserver | undefined
      let anchor: { element: HTMLElement; top: number } | undefined
      const more = () => {
        const current = board()
        if (
          !open() ||
          !viewport ||
          viewport.scrollTop > 160 ||
          !current?.hasMore ||
          !current.cursor ||
          pending() ||
          error()
        )
          return
        const element = viewport.querySelector<HTMLElement>('[data-slot="board-message-body"]')
        if (scroll.userScrolled() && element)
          anchor = { element, top: element.getBoundingClientRect().top - viewport.getBoundingClientRect().top }
        request(current.cursor)
      }
      createEffect(
        on(
          () => board()?.messages,
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
        <Dialog
          title={language.t("task.swarm.title")}
          size="large"
          class="task-board"
          action={
            <div class="task-board-actions">
              <Show when={pending()}>
                <span
                  role="status"
                  aria-label={language.t(pending()?.before ? "session.messages.loadingEarlier" : "task.swarm.loading")}
                >
                  <Spinner />
                </span>
              </Show>
              <Tooltip value={language.t("task.swarm.refresh")}>
                <IconButton
                  icon="refresh"
                  size="small"
                  variant="ghost"
                  aria-label={language.t("task.swarm.refresh")}
                  disabled={!!pending()}
                  onClick={() => {
                    scroll.resume()
                    request()
                  }}
                />
              </Tooltip>
              <Tooltip value={language.t("task.swarm.reset")}>
                <IconButton
                  icon="trash"
                  size="small"
                  variant="ghost"
                  aria-label={language.t("task.swarm.reset")}
                  disabled={!!pending()}
                  onClick={reset}
                />
              </Tooltip>
              <IconButton
                icon="close-small"
                size="small"
                variant="ghost"
                aria-label={language.t("common.close")}
                onClick={() => dialog.close()}
              />
            </div>
          }
        >
          <Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
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
              if (anchor && pending()?.before && viewport) {
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
              <For each={board()?.messages ?? []}>
                {(message) => <BoardMessage {...message} onSessionClick={openAgent} />}
              </For>
            </div>
          </div>
        </Dialog>
      )
    }, true)
  }

  return {
    shown: () => allowed() && present(),
    unread: () => !!latest() && latest() !== seen(),
    messages: () => board()?.messages ?? [],
    busy: () => !!pending(),
    load: () => request(),
    mark,
    view,
    reset,
    navigate: (id: string, title?: string) => navigate?.(id, title),
  }
}

export type SwarmBoardState = ReturnType<typeof useSwarmBoard>

/** The dock button: the latest posts in a small panel, with a way to the full board. */
export const SwarmBoardButton: Component<{ state: SwarmBoardState; rule?: boolean; active: boolean }> = (props) => {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const recent = createMemo(() => props.state.messages().slice(-RECENT))
  let list: HTMLDivElement | undefined

  createEffect(() => {
    if (!props.state.shown()) setOpen(false)
  })
  // The panel is a portal, so it would outlive the dock state that hides this
  // button. Close it when that state stops being the active one.
  createEffect(() => {
    if (!props.active) setOpen(false)
  })
  createEffect(() => {
    if (open()) props.state.mark()
  })
  // The newest post is at the bottom, like the full board.
  createEffect(
    on([open, recent], () => {
      if (open()) queueMicrotask(() => list && (list.scrollTop = list.scrollHeight))
    }),
  )

  const toggle = (next: boolean) => {
    setOpen(next)
    if (next) props.state.load()
  }
  const full = () => {
    setOpen(false)
    props.state.view()
  }
  const clear = () => {
    setOpen(false)
    props.state.reset()
  }
  const agent = (id: string, title?: string) => {
    setOpen(false)
    props.state.navigate(id, title)
  }

  // Data attributes are not part of the button prop type, so they go through
  // a plain record. Popover spreads it onto its trigger button.
  const attrs = createMemo(
    () =>
      ({
        type: "button",
        "data-component": "board-trigger",
        "data-rule": props.rule ? "" : undefined,
        "data-unread": props.state.unread() ? "" : undefined,
        "aria-label": language.t("task.swarm.title"),
      }) as Record<string, string | undefined> as ComponentProps<"button">,
  )

  return (
    <Show when={props.state.shown()}>
      <Popover
        open={open()}
        onOpenChange={toggle}
        placement="top-start"
        gutter={6}
        class="board-panel"
        contentLabel={language.t("task.swarm.title")}
        triggerAs="button"
        triggerProps={attrs()}
        trigger={<Icon name="speech-bubble" size="small" />}
      >
        <div data-slot="board-panel">
          <div data-slot="board-panel-header">
            <span data-slot="board-panel-title">{language.t("task.swarm.title")}</span>
            <span data-slot="board-panel-actions">
              <Tooltip value={language.t("task.swarm.refresh")} placement="top">
                <IconButton
                  icon="refresh"
                  variant="ghost"
                  size="small"
                  aria-label={language.t("task.swarm.refresh")}
                  disabled={props.state.busy()}
                  onClick={() => props.state.load()}
                />
              </Tooltip>
              <Tooltip value={language.t("task.swarm.reset")} placement="top">
                <IconButton
                  icon="trash"
                  variant="ghost"
                  size="small"
                  aria-label={language.t("task.swarm.reset")}
                  disabled={props.state.busy()}
                  onClick={clear}
                />
              </Tooltip>
              <Tooltip value={language.t("task.swarm.open")} placement="top">
                <IconButton
                  icon="square-arrow-top-right"
                  variant="ghost"
                  size="small"
                  aria-label={language.t("task.swarm.open")}
                  onClick={full}
                />
              </Tooltip>
            </span>
          </div>
          <div data-slot="board-panel-list" data-component="board-messages" ref={list}>
            <For each={recent()}>{(message) => <BoardMessage {...message} onSessionClick={agent} />}</For>
          </div>
        </div>
      </Popover>
    </Show>
  )
}
