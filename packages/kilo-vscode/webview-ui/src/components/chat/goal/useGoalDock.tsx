/** @jsxImportSource solid-js */

import { Show, createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useSession } from "../../../context/session"
import { useLanguage } from "../../../context/language"
import { useServer } from "../../../context/server"

interface GoalDockProps {
  actions: Accessor<boolean>
  working: Accessor<boolean>
  readonly?: boolean
}

export function useGoalDock(props: GoalDockProps) {
  const session = useSession()
  const language = useLanguage()
  const server = useServer()
  const goal = () => session.currentSession()?.goal
  const working = props.working
  const actions = props.actions
  const status = () => goal()?.status ?? (goal()?.active ? "active" : "paused")
  const label = () => `${language.t("session.goal.label")}: ${language.t(`session.goal.${status()}`)}`
  const [open, setOpen] = createSignal(false)
  const [row, setRow] = createSignal<HTMLDivElement>()
  const [lane, setLane] = createSignal<HTMLDivElement>()
  const [badge, setBadge] = createSignal<HTMLSpanElement>()
  const [text, setText] = createSignal<HTMLSpanElement>()
  const [compact, setCompact] = createSignal(false)

  createEffect(() => {
    if (!actions() || !goal()) setOpen(false)
  })

  createEffect(() => {
    const trigger = badge()?.closest('[data-component="tooltip-trigger"]')
    if (!(trigger instanceof HTMLElement)) return
    trigger.tabIndex = 0
    trigger.setAttribute("role", "img")
    trigger.setAttribute("aria-label", label())
    trigger.setAttribute("aria-description", goal()?.text ?? "")
  })

  createEffect(() => {
    const container = row()
    const content = lane()
    const control = badge()
    const caption = text()
    if (
      !working() ||
      !goal()?.active ||
      !label() ||
      !container ||
      !content ||
      !control ||
      !caption ||
      typeof ResizeObserver === "undefined"
    )
      return
    const measure = () => {
      const icon = control.querySelector('[data-component="icon"]')
      if (!icon) return
      const css = getComputedStyle(control)
      const gap = Number.parseFloat(css.getPropertyValue("--goal-label-gap")) || 0
      const padding = Number.parseFloat(css.paddingLeft) + Number.parseFloat(css.paddingRight)
      const required = icon.getBoundingClientRect().width + caption.scrollWidth + gap + padding
      const available = container.getBoundingClientRect().right - content.getBoundingClientRect().right + 8
      setCompact(container.clientWidth === 0 || required > available + 1)
    }
    const observer = new ResizeObserver(measure)
    for (const el of [container, content, control, caption]) observer.observe(el)
    onCleanup(() => observer.disconnect())
    measure()
  })

  const detail = () => (
    <div class="session-goal-tooltip">
      <span>{label()}</span>
      <span>{goal()?.text}</span>
      <Show when={goal()?.reason}>
        <span>{goal()?.reason}</span>
      </Show>
    </div>
  )

  const control = () => (
    <Show when={goal()}>
      {(goal) => (
        <DropdownMenu
          open={open()}
          onOpenChange={(value) => setOpen(actions() && value)}
          placement="top-end"
          gutter={6}
        >
          <Tooltip value={detail()} placement="top">
            <DropdownMenu.Trigger
              as={Button}
              variant="ghost"
              size="small"
              class="session-goal-action"
              disabled={props.readonly || !actions()}
              aria-label={label()}
            >
              <Icon name="target" size="small" />
              {language.t("session.goal.label")}
              <Icon name="chevron-down" size="small" />
            </DropdownMenu.Trigger>
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="session-goal-menu">
              <DropdownMenu.Group>
                <DropdownMenu.GroupLabel class="session-goal-menu-state">
                  {language.t(`session.goal.${status()}`)}
                </DropdownMenu.GroupLabel>
                <div class="session-goal-menu-title">{goal().text}</div>
                <Show when={goal().reason}>
                  <div class="session-goal-menu-title">{goal().reason}</div>
                </Show>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  disabled={props.readonly || !actions() || !server.isConnected()}
                  onSelect={() => session.sendCommand("goal", goal().active ? "pause" : "resume")}
                >
                  <Icon name={goal().active ? "stop" : "play"} size="small" />
                  <DropdownMenu.ItemLabel>
                    {language.t(
                      goal().active
                        ? "session.goal.pause"
                        : status() === "complete"
                          ? "session.goal.restart"
                          : "session.goal.resume",
                    )}
                  </DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  disabled={props.readonly || !actions() || !server.isConnected()}
                  onSelect={() => session.sendCommand("goal", "clear")}
                >
                  <Icon name="trash" size="small" />
                  <DropdownMenu.ItemLabel>{language.t("session.goal.clear")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </DropdownMenu.Group>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      )}
    </Show>
  )

  return {
    control,
    row: setRow,
    lane: setLane,
    running: () => working() && goal()?.active,
    status: () => (
      <Show when={working() && goal()?.active}>
        <Tooltip class="session-goal-status" value={detail()} placement="top">
          <span class="session-goal-status-content" ref={setBadge} data-compact={compact() ? "" : undefined}>
            <Icon name="target" size="small" />
            <span class="session-goal-status-label" ref={setText} aria-hidden="true">
              {label()}
            </span>
          </span>
        </Tooltip>
      </Show>
    ),
  }
}
