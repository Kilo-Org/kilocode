/** @jsxImportSource solid-js */

/**
 * main's SessionDock (components/chat/SessionDock.tsx): one row between the transcript and composer. Both working
 * and action states stay mounted in the same grid cell; the inactive one is hidden and out of flow, so the row is
 * exactly as tall as the visible state. Blocking surfaces (permission or question) hide both.
 *
 * Only the working and actions states are ported so far, so the file keeps another name until the rest lands: the
 * background agent stack, the swarm board button, the todo chip and the goal badge come with their own features.
 */
import { type Component, type ComponentProps, type JSX } from "solid-js"
import { WorkingIndicator } from "../shared/WorkingIndicator"
import { showsWorking } from "../shared/working-indicator-utils"

type SessionDockProps = ComponentProps<typeof WorkingIndicator> & {
  /** Idle-state content. Renders nothing when no action applies. */
  actions?: JSX.Element
  /** Whether idle-state content exists for this surface. */
  hasActions?: boolean
  /** True while a permission or question owns the row. */
  blocked: boolean
}

export const SessionDock: Component<SessionDockProps> = (props) => {
  const working = () => showsWorking(props.status, props.submitting, props.blocked)
  const actions = () => !working() && !props.blocked && (props.hasActions ?? false)
  const active = () => working() || actions()

  return (
    <div class="session-dock" data-component="session-dock" data-active={active() ? "" : undefined}>
      <div class="session-dock-state" data-active={working() ? "" : undefined} aria-hidden={!working()}>
        <div class="session-working">
          <WorkingIndicator
            status={props.status}
            submitting={props.submitting}
            timing={props.timing}
            text={props.text}
            retry={props.retry}
            onCancel={props.onCancel}
            onScrollToBottom={props.onScrollToBottom}
          />
          <div class="session-working-trail" />
        </div>
      </div>
      <div class="session-dock-state" data-active={actions() ? "" : undefined} aria-hidden={!actions()}>
        {props.actions}
      </div>
    </div>
  )
}
