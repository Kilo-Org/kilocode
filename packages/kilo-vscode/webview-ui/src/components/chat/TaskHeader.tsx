/**
 * TaskHeader component
 * Sticky header above the chat messages showing session title,
 * cost and a compact button.
 *
 * Main's component on native v2 session data. Not ported yet: the task timeline, context progress and token usage
 * rows, the transcript search, the subagent model row and the per-model cost breakdown.
 */

import { Component, Show, createMemo, createSignal, createEffect } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"
import { SessionRenameEditor } from "../shared/SessionRenameEditor"
import { useV2 } from "../../v2/client"

interface TaskHeaderProps {
  sessionID: string
  readonly?: boolean
}

export const TaskHeader: Component<TaskHeaderProps> = (props) => {
  const v2 = useV2()
  const language = useLanguage()
  const info = () => v2.data.session.get(props.sessionID)

  const title = createMemo(() => info()?.title ?? language.t("command.session.new"))
  const canRename = createMemo(() => !props.readonly && !!info())
  const hasMessages = createMemo(() => v2.data.session.message.list(props.sessionID).length > 0)
  const busy = createMemo(() => v2.data.session.status(props.sessionID) === "running")
  const canCompact = createMemo(() => !busy() && hasMessages())

  const money = createMemo(() => new Intl.NumberFormat(language.locale(), { style: "currency", currency: "USD" }))

  const cost = createMemo(() => {
    // The family total: the session and its subagents, as v1 and the TUI footer show.
    const value = v2.data.session.cost(props.sessionID)
    if (value === 0) return undefined
    return money().format(value)
  })

  const [renaming, setRenaming] = createSignal<{ id: string; title: string }>()

  const startRename = () => {
    if (props.readonly) return
    const current = info()
    if (!current) return
    setRenaming({ id: current.id, title: current.title ?? "" })
  }

  const commitRename = (title: string) => {
    const target = renaming()
    if (!target) return
    setRenaming(undefined)
    if (title === target.title) return
    // Same path as Session History: remember() shows the title at once, the sync reads the new update time.
    void v2.api.session
      .update({ sessionID: target.id, title })
      .then(() => {
        const current = v2.data.session.get(target.id)
        if (current) v2.data.session.remember({ ...current, title })
        v2.data.session.invalidate(target.id)
        return v2.data.session.sync(target.id)
      })
      .catch(v2.report)
  }

  const cancelRename = () => {
    setRenaming(undefined)
  }

  createEffect(() => {
    const target = renaming()
    if (target && props.sessionID !== target.id) setRenaming(undefined)
  })

  return (
    <Show when={hasMessages()}>
      <div data-component="task-header">
        <div data-slot="task-header-title">
          <Show
            when={!renaming()}
            fallback={
              <SessionRenameEditor
                title={renaming()?.title ?? ""}
                autosize
                onSave={commitRename}
                onCancel={cancelRename}
              />
            }
          >
            <span
              data-slot="task-header-title-trigger"
              data-renamable={canRename() ? "" : undefined}
              title={canRename() ? language.t("agentManager.worktree.doubleClickRename") : title()}
              tabIndex={canRename() ? 0 : undefined}
              role={canRename() ? "button" : undefined}
              onDblClick={startRename}
              onKeyDown={(e) => {
                if (!canRename() || (e.key !== "Enter" && e.key !== " ")) return
                e.preventDefault()
                startRename()
              }}
            >
              <span data-slot="task-header-title-label" dir="auto">
                {title()}
              </span>
            </span>
          </Show>
        </div>
        <div data-slot="task-header-stats">
          <Show when={cost()}>
            {(c) => (
              <Tooltip value={<span>{language.t("context.usage.sessionCost")}</span>} placement="bottom">
                <span>{c()}</span>
              </Tooltip>
            )}
          </Show>
          <Show when={!props.readonly}>
            <Tooltip value={language.t("command.session.compact")} placement="bottom">
              <IconButton
                icon="compress"
                size="small"
                variant="ghost"
                disabled={!canCompact()}
                onClick={() => void v2.data.session.compact({ sessionID: props.sessionID }).catch(v2.report)}
                aria-label={language.t("command.session.compact")}
              />
            </Tooltip>
          </Show>
        </div>
      </div>
    </Show>
  )
}
