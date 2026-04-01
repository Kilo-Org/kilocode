/**
 * TaskHeader component
 * Sticky header above the chat messages showing session title,
 * cost, context usage, and a compact button.
 * Also shows todo progress when the session has todos.
 */

import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import type { TodoItem } from "../../types/messages"

interface TaskHeaderProps {
  readonly?: boolean
}

export const TaskHeader: Component<TaskHeaderProps> = (props) => {
  const session = useSession()
  const language = useLanguage()

  const title = createMemo(() => session.currentSession()?.title ?? language.t("command.session.new"))
  const hasMessages = createMemo(() => session.messages().length > 0)
  const busy = createMemo(() => session.status() === "busy")
  const canCompact = createMemo(() => !busy() && hasMessages() && !!session.selected())

  const fmt = (n: number) => new Intl.NumberFormat(language.locale(), { style: "currency", currency: "USD" }).format(n)

  const breakdown = () => session.costBreakdown()

  const cost = createMemo(() => {
    const total = breakdown().reduce((sum, e) => sum + e.cost, 0)
    if (total === 0) return undefined
    return fmt(total)
  })

  const costTooltip = createMemo(() => {
    const items = breakdown()
    if (items.length <= 1) return <span>{language.t("context.usage.sessionCost")}</span>
    return (
      <div style={{ "text-align": "left", "white-space": "nowrap" }}>
        <For each={items}>{(e) => <div>{`${e.label}: ${fmt(e.cost)}`}</div>}</For>
      </div>
    )
  })

  const context = createMemo(() => {
    const usage = session.contextUsage()
    if (!usage) return undefined
    const tokens = usage.tokens.toLocaleString(language.locale())
    const pct = usage.percentage !== null ? `${usage.percentage}%` : undefined
    return { tokens, pct }
  })

  const todos = createMemo(() => session.todos())
  const hasTodos = createMemo(() => todos().length > 0)
  const doneCount = createMemo(() => todos().filter((t: TodoItem) => t.status === "completed").length)
  const totalCount = createMemo(() => todos().length)
  const allDone = createMemo(() => doneCount() === totalCount() && totalCount() > 0)

  const todoSummary = createMemo(() => {
    const done = doneCount()
    const total = totalCount()
    if (total === 0) return ""
    if (done === total) return language.t("task.todos.allDone", { count: String(total) })
    return language.t("task.todos.progress", { done: String(done), total: String(total) })
  })

  const [todosOpen, setTodosOpen] = createSignal(false)

  return (
    <Show when={hasMessages()}>
      <div data-component="task-header">
        <div data-slot="task-header-title" title={title()}>
          {title()}
        </div>
        <div data-slot="task-header-stats">
          <Show when={cost()}>
            {(c) => (
              <Tooltip value={costTooltip()} placement="bottom">
                <span>{c()}</span>
              </Tooltip>
            )}
          </Show>
          <Show when={context()}>
            {(ctx) => (
              <Tooltip
                value={ctx().pct ? `${ctx().tokens} tokens (${ctx().pct} of context)` : `${ctx().tokens} tokens`}
                placement="bottom"
              >
                <span>{ctx().pct ?? ctx().tokens}</span>
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
                onClick={() => session.compact()}
                aria-label={language.t("command.session.compact")}
              />
            </Tooltip>
          </Show>
        </div>
      </div>
      <Show when={hasTodos()}>
        <div data-component="task-header-todos">
          <button
            data-slot="task-header-todos-trigger"
            onClick={() => setTodosOpen((v) => !v)}
            aria-expanded={todosOpen()}
          >
            <Icon name="checklist" size="small" />
            <span data-slot="task-header-todos-summary" data-all-done={allDone() ? "" : undefined}>
              {todoSummary()}
            </span>
            <Icon
              name="chevron-down"
              size="small"
              data-slot="task-header-todos-arrow"
              data-open={todosOpen() ? "" : undefined}
            />
          </button>
          <Show when={todosOpen()}>
            <div data-slot="task-header-todos-list">
              <For each={todos()}>
                {(todo: TodoItem) => (
                  <Checkbox readOnly checked={todo.status === "completed"}>
                    <span
                      data-slot="task-header-todo-content"
                      data-completed={todo.status === "completed" ? "" : undefined}
                    >
                      {todo.content}
                    </span>
                  </Checkbox>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </Show>
  )
}
