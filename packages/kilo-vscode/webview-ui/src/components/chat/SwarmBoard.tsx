/**
 * Kilo Swarm: the shared agent board of a root session, on the `kilocode.board` RPC.
 *
 * The board belongs to the session, not to a run, so it outlives the background agents that post on it. The dock
 * shows its button next to the agent stack while agents exist, and alone in the same place after they are cleared or
 * the view reloads. The button opens the latest posts. The full board, with history and reset, opens in a dialog.
 *
 * A `changed` event for the root checks the newest post, which marks the button unread. An open panel or dialog
 * reads the newest page again.
 */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type Accessor,
  type Component,
  type ComponentProps,
  type JSX,
} from "solid-js"
import { KiloBoardRpc } from "@opencode/schema/kilocode/board"
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
import { useLanguage } from "../../context/language"
import { useV2 } from "../../v2/client"
import { mergeBoard, usesBoard, type SwarmBoard } from "./swarm-board"

/** Posts shown in the dock panel. Older posts are in the full board. */
const RECENT = 5
const PAGE = 50

type Pending = { scope: string; before?: string; confirmation?: string }

function errorType(error: unknown) {
  if (error && typeof error === "object" && "type" in error && typeof error.type === "string") return error.type
  return undefined
}

export function useSwarmBoard(input: {
  session: Accessor<string | undefined>
  open?: (sessionID: string, title?: string) => void
}) {
  const v2 = useV2()
  const language = useLanguage()
  const dialog = useDialog()
  const rpc = v2.api.rpc(KiloBoardRpc.Definition)
  const location = { directory: v2.directory }
  const [enabled, setEnabled] = createSignal(false)
  const [open, setOpen] = createSignal(false)
  const [board, setBoard] = createSignal<SwarmBoard>()
  const [error, setError] = createSignal<string>()
  const [pending, setPending] = createSignal<Pending>()
  // A one-post check runs on its own, so it never blocks or replaces a full load.
  const [peeking, setPeeking] = createSignal(false)
  // The newest post, and the newest post the user has seen. The first load of a view counts as seen, so a reload
  // does not mark old posts as new.
  const [latest, setLatest] = createSignal<string>()
  const [seen, setSeen] = createSignal<string>()
  // True only for the full board reader, not the reset confirmation.
  const [reading, setReading] = createSignal(false)
  // The panel shown by the dock button, so a change while it is open reads the newest page.
  const [panel, setPanel] = createSignal(false)
  let fresh = true
  let again = false
  let layer: string | undefined
  // Bumped when a full load or a reset lands, so a late one-post check cannot restore a board that a reset just
  // cleared.
  let epoch = 0
  const present = () => !!board()?.messages.length
  const scope = createMemo(() => input.session() ?? "")
  const allowed = createMemo(() => {
    const id = input.session()
    if (!id || !enabled()) return false
    const info = v2.data.session.get(id)
    return !!info && !info.parentID
  })
  const used = createMemo(() => {
    const id = input.session()
    if (!id) return false
    return [id, ...v2.data.session.family(id)].some((item) => usesBoard(v2.data.session.message.list(item)))
  })

  const readStatus = () => {
    void rpc
      .status({}, { location })
      .then((value) => setEnabled(value.enabled))
      .catch(() => setEnabled(false))
  }

  const request = (before?: string, target?: { scope: string; sessionID: string; revision: number }) => {
    const sessionID = target?.sessionID ?? input.session()
    if (!sessionID || !allowed() || pending() || (target && target.scope !== scope())) return
    const current = scope()
    const expected: Pending = { scope: current, before, confirmation: target ? dialog.active?.id : undefined }
    setPending(expected)
    setError(undefined)
    const call = target
      ? rpc.reset({ sessionID, revision: target.revision }, { location })
      : rpc.get({ sessionID, before, limit: PAGE }, { location })
    void call.then(
      (next) => {
        if (current !== scope() || pending() !== expected) return
        setPending(undefined)
        if (next.ownerSessionID !== sessionID) {
          setError(language.t("task.swarm.failed"))
          return
        }
        if (!before) {
          note(next)
          epoch += 1
        }
        setBoard(mergeBoard(board(), next, before))
        if (expected.confirmation && dialog.active?.id === expected.confirmation) dialog.close()
      },
      (err: unknown) => {
        if (current !== scope() || pending() !== expected) return
        setPending(undefined)
        // A read never creates a board, so a session without posts has none yet.
        if (!target && !before && errorType(err) === "not_found") {
          epoch += 1
          setBoard(undefined)
          return
        }
        setError(language.t("task.swarm.failed"))
      },
    )
  }

  // A one-post check notes the newest post. It fills the board only while the board is empty.
  const peek = () => {
    const sessionID = input.session()
    if (!sessionID || !allowed()) return
    if (peeking()) {
      again = true
      return
    }
    const current = scope()
    const at = epoch
    setPeeking(true)
    const settle = () => {
      if (current !== scope()) return false
      setPeeking(false)
      if (again) {
        again = false
        queueMicrotask(peek)
      }
      return at === epoch
    }
    void rpc.get({ sessionID, limit: 1 }, { location }).then(
      (next) => {
        if (!settle() || next.ownerSessionID !== sessionID) return
        note(next)
        if (!present() || !next.messages.length) setBoard(next)
      },
      () => settle(),
    )
  }

  const note = (next: SwarmBoard) => {
    const id = next.messages.at(-1)?.id
    setLatest(id)
    if (!fresh) return
    fresh = false
    setSeen(id)
  }

  onCleanup(
    rpc.events.on("changed", (event) => {
      if (!allowed() || event.data.sessionID !== input.session()) return
      peek()
      if (open() || panel()) request()
    }),
  )

  createEffect(
    on(v2.connection.status, (status) => {
      if (status === "connected") readStatus()
    }),
  )
  // A config write reloads the documents on the server, which can turn Kilo Swarm on or off.
  onCleanup(v2.data.on("config.updated", () => readStatus()))

  createEffect(
    on(
      scope,
      () => {
        setOpen(false)
        setBoard(undefined)
        setPending(undefined)
        setPeeking(false)
        setError(undefined)
        setLatest(undefined)
        setSeen(undefined)
        fresh = true
        again = false
      },
      { defer: true },
    ),
  )

  createEffect(
    on([scope, allowed, v2.connection.status], () => {
      if (v2.connection.status() === "connected" && !present()) peek()
    }),
  )

  createEffect(() => {
    if (!allowed()) setOpen(false)
  })

  const mark = () => setSeen(latest())
  createEffect(() => {
    if (reading()) mark()
  })

  const shown = () => allowed() && (present() || used())

  const show = (content: () => JSX.Element, read = false) => {
    const current = scope()
    const valid = () => current === scope() && shown()
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
    const sessionID = input.session()
    if (!current || !sessionID || pending()) return
    const target = { scope: scope(), sessionID, revision: current.revision }
    setError(undefined)
    show(() => (
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
    ))
  }

  const openAgent = (id: string, title?: string) => {
    dialog.close()
    input.open?.(id, title)
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
                  disabled={!!pending() || !present()}
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
              <Show when={!present() && !pending()}>
                <div data-slot="board-message-note">{language.t("ui.messagePart.board.empty")}</div>
              </Show>
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
    shown,
    present,
    unread: () => !!latest() && latest() !== seen(),
    messages: () => board()?.messages ?? [],
    busy: () => !!pending(),
    load: () => request(),
    panel: setPanel,
    mark,
    view,
    reset,
    navigate: (id: string, title?: string) => input.open?.(id, title),
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
  // The panel is a portal, so it would outlive the dock state that hides this button. Close it when that state stops
  // being the active one.
  createEffect(() => {
    if (!props.active) setOpen(false)
  })
  createEffect(() => props.state.panel(open()))
  onCleanup(() => props.state.panel(false))
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

  // Data attributes are not part of the button prop type, so they go through a plain record. Popover spreads it onto
  // its trigger button.
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
                  disabled={props.state.busy() || !props.state.present()}
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
            <Show when={!props.state.present() && !props.state.busy()}>
              <div data-slot="board-message-note">{language.t("ui.messagePart.board.empty")}</div>
            </Show>
            <For each={recent()}>{(message) => <BoardMessage {...message} onSessionClick={agent} />}</For>
          </div>
        </div>
      </Popover>
    </Show>
  )
}
