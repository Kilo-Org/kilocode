// The Kilo session goal in the v2 webview: the status badge in the working trail, the control in the composer
// hint, and the header shown while the composer sets a goal. The state comes from the `kilocode.goal` RPC; the
// loop itself runs in the goal plugin of packages/kilo-plugin.
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { KiloGoalRpc } from "@opencode/schema/kilocode/goal"
import { createEffect, createSignal, on, onCleanup, Show, type Accessor } from "solid-js"
import { useLanguage } from "../context/language"
import { useV2 } from "./client"

export type GoalState = KiloGoalRpc.State

/** The goal of a session, fetched when the session or connection changes and kept current from `changed`. */
export function createGoal(session: Accessor<string | undefined>) {
  const v2 = useV2()
  const rpc = v2.api.rpc(KiloGoalRpc.Definition)
  const [goal, setGoal] = createSignal<GoalState>()
  const turn = { value: 0 }
  const load = (id: string) => {
    const current = ++turn.value
    const directory = v2.data.session.get(id)?.location.directory
    void rpc.get({ sessionID: id }, directory ? { location: { directory } } : undefined).then(
      (next) => {
        if (current === turn.value && session() === id) setGoal(next ?? undefined)
      },
      () => undefined,
    )
  }
  onCleanup(
    rpc.events.on("changed", (event) => {
      if (event.data.sessionID !== session()) return
      turn.value++
      setGoal(event.data.goal ?? undefined)
    }),
  )
  createEffect(
    on([session, v2.connection.status] as const, ([id, status]) => {
      setGoal(undefined)
      if (id && status === "connected") load(id)
    }),
  )
  return goal
}

export function goalStatusLabel(goal: GoalState, language: ReturnType<typeof useLanguage>) {
  return `${language.t("session.goal.label")}: ${language.t(`session.goal.${goal.status}`)}`
}

function detail(goal: GoalState, language: ReturnType<typeof useLanguage>) {
  return (
    <div class="session-goal-tooltip">
      <span>{goalStatusLabel(goal, language)}</span>
      <span>{goal.text}</span>
      <Show when={goal.reason}>
        <span>{goal.reason}</span>
      </Show>
      <Show when={goal.wait}>
        {(wait) => (
          <span>
            Waiting for {wait().kind} {wait().label}
          </span>
        )}
      </Show>
    </div>
  )
}

/** The badge that trails the working row while a goal is active, waiting or settling. */
export function GoalStatus(props: { goal: GoalState | undefined }) {
  const language = useLanguage()
  return (
    <Show when={props.goal}>
      {(goal) => (
        <Tooltip class="session-goal-status" value={detail(goal(), language)} placement="top">
          <span class="session-goal-status-content" tabIndex={0} role="img" aria-label={goalStatusLabel(goal(), language)}>
            <Icon name="target" size="small" />
            <span class="session-goal-status-label" aria-hidden="true">
              {goalStatusLabel(goal(), language)}
            </span>
          </span>
        </Tooltip>
      )}
    </Show>
  )
}

/** The goal control in the composer hint: state, objective, and the pause, resume and clear actions. */
export function GoalAction(props: {
  goal: GoalState | undefined
  disabled?: boolean
  onCommand: (text: string) => void
}) {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const label = () => (props.goal ? goalStatusLabel(props.goal, language) : language.t("prompt.goal.set"))
  const running = (goal: GoalState) => goal.status === "active" || goal.status === "waiting"
  const action = (goal: GoalState) => (running(goal) ? "pause" : "resume")
  const actionLabel = (goal: GoalState) =>
    language.t(
      running(goal)
        ? "session.goal.pause"
        : goal.status === "complete"
          ? "session.goal.restart"
          : "session.goal.resume",
    )
  const run = (text: string) => {
    setOpen(false)
    props.onCommand(text)
  }
  return (
    <Show when={props.goal}>
      {(goal) => (
        <Popover
          class="session-goal-menu"
          placement="top-end"
          open={open()}
          onOpenChange={(value) => !props.disabled && setOpen(value)}
          triggerAs={Button}
          triggerProps={{ variant: "ghost", size: "small", class: "session-goal-action", disabled: props.disabled, "aria-label": label() }}
          trigger={
            <>
              <Icon name="target" size="small" />
              {language.t("session.goal.label")}
              <svg class="selector-trigger-chevron" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 4l4 5H4l4-5z" />
              </svg>
            </>
          }
        >
          <div class="session-goal-menu-body">
            <div class="session-goal-menu-state">{language.t(`session.goal.${goal().status}`)}</div>
            <div class="session-goal-menu-title">{goal().text}</div>
            <Show when={goal().reason}>
              <div class="session-goal-menu-title">{goal().reason}</div>
            </Show>
            <div class="session-goal-menu-separator" />
            <button type="button" class="session-goal-menu-item" disabled={props.disabled} onClick={() => run(action(goal()))}>
              <Icon name={running(goal()) ? "stop" : "play"} size="small" />
              {actionLabel(goal())}
            </button>
            <button type="button" class="session-goal-menu-item" disabled={props.disabled} onClick={() => run("clear")}>
              <Icon name="trash" size="small" />
              {language.t("session.goal.clear")}
            </button>
          </div>
        </Popover>
      )}
    </Show>
  )
}

/** The header shown while the composer is setting a goal with `/goal`. */
export function GoalHeader(props: { onCancel: () => void }) {
  const language = useLanguage()
  return (
    <div class="prompt-goal-header">
      <Icon name="target" size="small" />
      <span>{language.t("prompt.goal.set")}</span>
      <Button variant="ghost" size="small" onClick={props.onCancel}>
        {language.t("common.cancel")}
      </Button>
    </div>
  )
}