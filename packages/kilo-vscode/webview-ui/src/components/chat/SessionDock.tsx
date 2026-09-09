/** @jsxImportSource solid-js */

/**
 * One row between the transcript and composer. Both working and action states
 * stay in the same grid cell so the taller state reserves the row's height,
 * including wrapped actions in narrow sidebars. Blocking surfaces hide both.
 */
import { type Component, type JSX } from "solid-js"
import { useSession } from "../../context/session"
import { WorkingIndicator } from "../shared/WorkingIndicator"
import { showsWorking } from "../shared/working-indicator-utils"
import { useGoalDock } from "./goal/useGoalDock"

interface SessionDockProps {
  /** Idle-state content. Renders nothing when no action applies. */
  actions?: (goal: () => JSX.Element) => JSX.Element
  /** Whether idle-state content exists for this surface. */
  hasActions?: () => boolean
  /** True while a permission, question, suggestion, or requirement owns the row. */
  blocked?: boolean
  readonly?: boolean
}

export const SessionDock: Component<SessionDockProps> = (props) => {
  const session = useSession()
  const working = () => showsWorking(session.status(), session.submitting(), !!props.blocked)
  const actions = () => !working() && !props.blocked && (props.hasActions?.() ?? false)
  const active = () => working() || actions()
  const goal = useGoalDock({
    working,
    actions,
    get readonly() {
      return props.readonly
    },
  })

  return (
    <div class="session-dock" data-component="session-dock" data-active={active() ? "" : undefined}>
      <div class="session-dock-state" ref={goal.row} data-active={working() ? "" : undefined} aria-hidden={!working()}>
        <div class="session-working" ref={goal.lane} data-goal={goal.running() ? "" : undefined}>
          <WorkingIndicator />
          {goal.status()}
        </div>
      </div>
      <div class="session-dock-state" data-active={actions() ? "" : undefined} aria-hidden={!actions()}>
        {props.actions?.(goal.control)}
      </div>
    </div>
  )
}
