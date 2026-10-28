/** @jsxImportSource solid-js */

/**
 * main's SessionDock (components/chat/SessionDock.tsx): one row between the transcript and composer. Only its
 * working state is ported so far, so the file keeps another name until the rest lands; the
 * idle actions row, the background agent stack, the todo chip and the goal badge come with their own features. A
 * blocking surface (permission or question) hides the row, as on main.
 */
import { type Component, type ComponentProps } from "solid-js"
import { WorkingIndicator } from "../shared/WorkingIndicator"
import { showsWorking } from "../shared/working-indicator-utils"

type SessionDockProps = ComponentProps<typeof WorkingIndicator> & {
  /** True while a permission or question owns the row. */
  blocked: boolean
}

export const SessionDock: Component<SessionDockProps> = (props) => {
  const working = () => showsWorking(props.status, props.submitting, props.blocked)

  return (
    <div class="session-dock" data-component="session-dock" data-active={working() ? "" : undefined}>
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
    </div>
  )
}
