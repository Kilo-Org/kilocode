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

import { Show, type Component, type JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { useServer } from "../../context/server"
import { WorkingIndicator } from "../shared/WorkingIndicator"
import { showsWorking } from "../shared/working-indicator-utils"

interface SessionDockProps {
  /** Idle-state content. Renders nothing when no action applies. */
  actions?: () => JSX.Element
  /** Whether idle-state content exists for this surface. */
  hasActions?: () => boolean
  /** True while a permission, question, suggestion, or requirement owns the row. */
  blocked?: boolean
  readonly?: boolean
}

export const SessionDock: Component<SessionDockProps> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const server = useServer()
  const goal = () => session.currentSession()?.goal
  const working = () => showsWorking(session.status(), session.submitting(), !!props.blocked)
  const actions = () => !working() && !props.blocked && (props.hasActions?.() ?? false)
  const active = () => !!goal() || working() || actions()

  return (
    <div
      class="session-dock"
      data-component="session-dock"
      data-active={active() ? "" : undefined}
      data-goal={goal() ? "" : undefined}
    >
      <div class="session-dock-state" data-active={working() ? "" : undefined} aria-hidden={!working()}>
        <WorkingIndicator />
      </div>
      <div class="session-dock-state" data-active={actions() ? "" : undefined} aria-hidden={!actions()}>
        {props.actions?.()}
      </div>
      <Show when={goal()}>
        {(goal) => (
          <DropdownMenu placement="top-end" gutter={6}>
            <DropdownMenu.Trigger
              as={Button}
              variant="secondary"
              size="small"
              class="session-goal-action"
              disabled={props.readonly}
              aria-label={`${language.t("session.goal.label")}: ${language.t(goal().active ? "session.goal.active" : "session.goal.paused")}`}
            >
              {language.t("session.goal.label")}
              <Icon name="chevron-down" size="small" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="session-goal-menu">
                <DropdownMenu.Group>
                  <DropdownMenu.GroupLabel class="session-goal-menu-state">
                    {language.t(goal().active ? "session.goal.active" : "session.goal.paused")}
                  </DropdownMenu.GroupLabel>
                  <div class="session-goal-menu-title">{goal().text}</div>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    disabled={props.readonly || !server.isConnected()}
                    onSelect={() => session.sendCommand("goal", goal().active ? "pause" : "resume")}
                  >
                    <Icon name={goal().active ? "stop" : "play"} size="small" />
                    <DropdownMenu.ItemLabel>
                      {language.t(goal().active ? "session.goal.pause" : "session.goal.resume")}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    disabled={props.readonly || !server.isConnected()}
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
    </div>
  )
}
