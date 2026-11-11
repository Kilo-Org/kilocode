/** @jsxImportSource solid-js */

// The goal in the session dock: a badge that trails the working spinner while the goal runs, and the Goal menu in the
// idle actions row, which pauses, resumes, restarts or clears it. main's useGoalDock over the v2 goal plugin.
import { Show, createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../../context/language"
import type { GoalSource } from "../../../v2/goal"

interface GoalDockProps {
  source: GoalSource
  actions: Accessor<boolean>
  working: Accessor<boolean>
  /** Whether the menu can send a control now. */
  connected: Accessor<boolean>
  /** Set by the dock when it plans the trailing group itself. */
  compact?: Accessor<boolean | undefined>
}

export function useGoalDock(props: GoalDockProps) {
  const language = useLanguage()
  const goal = props.source.goal
  const working = props.working
  const actions = props.actions
  const running = () => working() && goal()?.status === "active"
  const status = () => goal()?.status ?? "paused"
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
    trigger.setAttribute("aria-description", goal()?.objective ?? "")
  })

  // Without a todo chip the badge plans its own collapse: the label hides when the badge would leave the row.
  createEffect(() => {
    const container = row()
    const content = lane()
    const control = badge()
    const caption = text()
    if (!running() || !container || !content || !control || !caption || typeof ResizeObserver === "undefined") return
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
      <span>{goal()?.objective}</span>
      <Show when={goal()?.reason}>
        <span>{goal()?.reason}</span>
      </Show>
    </div>
  )

  const disabled = () => !actions() || !props.connected()

  const control = () => (
    <Show when={goal()}>
      {(current) => (
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
              disabled={!actions()}
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
                <div class="session-goal-menu-title">{current().objective}</div>
                <Show when={current().reason}>
                  <div class="session-goal-menu-title">{current().reason}</div>
                </Show>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  disabled={disabled()}
                  onSelect={() =>
                    props.source.control(
                      current().status === "active" ? "pause" : current().status === "complete" ? "restart" : "resume",
                    )
                  }
                >
                  <Icon name={current().status === "active" ? "stop" : "play"} size="small" />
                  <DropdownMenu.ItemLabel>
                    {language.t(
                      current().status === "active"
                        ? "session.goal.pause"
                        : current().status === "complete"
                          ? "session.goal.restart"
                          : "session.goal.resume",
                    )}
                  </DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
                <DropdownMenu.Item disabled={disabled()} onSelect={() => props.source.control("clear")}>
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
    running,
    status: () => (
      <Show when={running()}>
        <Tooltip class="session-goal-status" value={detail()} placement="top">
          <span
            class="session-goal-status-content"
            ref={setBadge}
            data-compact={(props.compact?.() ?? compact()) ? "" : undefined}
          >
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
