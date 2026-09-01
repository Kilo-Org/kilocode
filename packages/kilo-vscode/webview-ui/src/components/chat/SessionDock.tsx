/** @jsxImportSource solid-js */

/**
 * SessionDock component
 *
 * One row between the transcript and the composer. It shows the working
 * indicator while a turn runs, the session actions (New Session, Fork Session,
 * Move to Worktree, changes) once it finishes, and nothing while a permission,
 * question, or requirement surface owns the interaction.
 *
 * The transcript viewport is whatever is left above the composer, so a row that
 * grew when the actions appeared shifted the visible conversation by its own
 * height. Both states are therefore always laid out, stacked in one grid cell,
 * and only the active one is visible. The row measures the taller state at the
 * current width, which also keeps the wrapped narrow-sidebar actions row from
 * being clipped.
 */

import { type Component, type JSX } from "solid-js"
import { useSession } from "../../context/session"
import { WorkingIndicator } from "../shared/WorkingIndicator"
import { showsWorking } from "../shared/working-indicator-utils"

interface SessionDockProps {
  /** Idle-state content. Renders nothing when no action applies. */
  actions?: () => JSX.Element
  /** Whether idle-state content exists for this surface. */
  hasActions?: () => boolean
  /** True while a permission, question, suggestion, or requirement owns the row. */
  blocked?: boolean
}

export const SessionDock: Component<SessionDockProps> = (props) => {
  const session = useSession()
  const working = () => showsWorking(session.status(), session.submitting(), !!props.blocked)
  const actions = () => !working() && !props.blocked && (props.hasActions?.() ?? false)
  const active = () => working() || actions()

  return (
    <div class="session-dock" data-component="session-dock" data-active={active() ? "" : undefined}>
      <div class="session-dock-state" data-active={working() ? "" : undefined} aria-hidden={!working()}>
        <WorkingIndicator />
      </div>
      <div class="session-dock-state" data-active={actions() ? "" : undefined} aria-hidden={!actions()}>
        {props.actions?.()}
      </div>
    </div>
  )
}
