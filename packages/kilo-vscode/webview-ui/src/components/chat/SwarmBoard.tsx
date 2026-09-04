import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, type Component, type JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { BoardMessage } from "@kilocode/kilo-ui/board-message"
import { createAutoScroll } from "@kilocode/kilo-ui/hooks"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import type { SessionBoard } from "../../types/messages"

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

export const SwarmBoard: Component<{ readonly?: boolean; projectId?: string }> = (props) => {
  const session = useSession()
  const config = useConfig()
  const language = useLanguage()
  const vscode = useVSCode()
  const dialog = useDialog()
  const [open, setOpen] = createSignal(false)
  const [board, setBoard] = createSignal<SessionBoard>()
  const [error, setError] = createSignal<string>()
  const [pending, setPending] = createSignal<{
    requestID: string
    sessionID: string
    projectId?: string
    scope: string
    before?: string
    confirmation?: string
  }>()
  let jobs = ""
  let layer: string | undefined
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
      config.config().experimental?.shared_agent_board
    )
  })

  const request = (
    before?: string,
    target?: { scope: string; sessionID: string; projectId?: string; revision: number },
    limit = 50,
  ) => {
    const sessionID = target?.sessionID ?? session.currentSessionID()
    if (!sessionID || !allowed() || pending() || (target && target.scope !== scope())) return
    const base = { sessionID, projectId: target?.projectId ?? props.projectId, requestID: crypto.randomUUID() }
    setPending({ ...base, scope: scope(), before, confirmation: target ? dialog.active?.id : undefined })
    setError(undefined)
    vscode.postMessage(
      target
        ? { type: "resetSessionBoard", ...base, revision: target.revision }
        : { type: "requestSessionBoard", ...base, before, limit },
    )
  }

  const check = () => {
    if (vscode.active() && !present()) request(undefined, undefined, 1)
  }

  onCleanup(
    vscode.onMessage((message) => {
      if (
        message.type === "backgroundJobsLoaded" &&
        message.sessionID === session.currentSessionID() &&
        !message.error
      ) {
        const next = message.jobs.map((job) => `${job.id}:${job.status}`).join()
        if (next !== jobs || message.jobs.some((job) => job.status === "running")) check()
        jobs = next
      }
      if (message.type === "sessionUpdated" && message.session.id === session.currentSessionID()) check()
      if (message.type !== "sessionBoardLoaded") return
      const expected = pending()
      if (
        !expected ||
        expected.scope !== scope() ||
        expected.requestID !== message.requestID ||
        expected.sessionID !== message.sessionID
      )
        return
      if (expected.projectId !== undefined && expected.projectId !== message.projectId) return
      setPending(undefined)
      if (message.error || !message.board || message.board.ownerSessionID !== expected.sessionID) {
        setError(language.t("task.swarm.failed"))
        return
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
        setError(undefined)
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

  const show = (content: () => JSX.Element) => {
    const current = scope()
    const valid = () => current === scope() && allowed() && present() && vscode.active()
    void dialog
      .show(
        () => {
          setOpen(true)
          onCleanup(() => setOpen(false))
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
                scroll.contentRef(el)
                resize = new ResizeObserver(() => {
                  if (viewport && viewport.scrollHeight <= viewport.clientHeight) more()
                })
                resize.observe(el)
              }}
            >
              <For each={board()?.messages ?? []}>{(message) => <BoardMessage {...message} />}</For>
            </div>
          </div>
        </Dialog>
      )
    })
  }

  return (
    <Show when={allowed() && present()}>
      <Tooltip value={language.t("task.swarm.title")} placement="bottom" inactive={open()}>
        <IconButton
          icon="speech-bubble"
          variant="ghost"
          size="small"
          aria-label={language.t("task.swarm.title")}
          onClick={view}
        />
      </Tooltip>
    </Show>
  )
}
