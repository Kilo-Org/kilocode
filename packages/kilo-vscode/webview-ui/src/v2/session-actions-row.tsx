// The session actions row above the composer: the background agent stack, New Session, the worktree actions, Changes
// and the todo chip. The sidebar shows every action; the Agent Manager panel omits New Session and Changes because its
// tab bar and diff panel own them.
import { Button } from "@kilocode/kilo-ui/button"
import { CountUp, createCountStart } from "@kilocode/kilo-ui/count-up"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Show, type JSX } from "solid-js"
import { useLanguage } from "../context/language"

type Stats = { files: number; additions: number; deletions: number }

export function SessionActionsRow(props: {
  hasMessages: boolean
  /** The workspace project's current branch. The worktree actions are hidden when there is none. */
  branch?: string
  /** The sidebar's New Session button; the Agent Manager has its own new-tab control. */
  onNewSession?: () => void
  onNewWorktree: () => void
  onNewWorktreeFromBranch: (branch: string) => void
  onConfigureWorktree: () => void
  /** Moves the open session into a new worktree; absent when the session cannot move. */
  onMoveToWorktree?: () => void
  moving: boolean
  moveDetail: string
  /** The working tree of the open session, for the Move and Changes tooltips. */
  stats?: Stats
  /** Opens the changes of the open session; absent when the surface has its own changes control. */
  onShowChanges?: () => void
  todos?: JSX.Element
  /** The background agent stack and the board button; the dock places them on a line with room. */
  agents?: JSX.Element
}) {
  const language = useLanguage()
  const start = createCountStart(() => props.stats !== undefined)
  const worktreeTooltip = language.t("sidebar.session.newWorktree.tooltip")
  const advancedTooltip = language.t("sidebar.session.configureWorktree.tooltip")
  const moveTooltip = () => {
    const value = props.stats
    if (!value?.files) return language.t("sidebar.session.moveToWorktree.tooltip.empty")
    if (value.files === 1) return language.t("sidebar.session.moveToWorktree.tooltip.one")
    return language.t("sidebar.session.moveToWorktree.tooltip.other", { files: value.files })
  }
  const changesTooltip = () => {
    const value = props.stats
    if (!value?.files) return language.t("sidebar.session.showChanges.tooltip.empty")
    return (
      <span class="session-changes-tooltip">
        <span>
          {value.files} {language.t(value.files === 1 ? "ui.common.file.one" : "ui.common.file.other")}
        </span>
        <span class="session-changes-tooltip-separator">·</span>
        <span class="session-diff-add">+{value.additions}</span>
        <span class="session-diff-del">-{value.deletions}</span>
        <span>{language.t("command.session.show.changes")}</span>
      </span>
    )
  }
  let worktreeRef: HTMLDivElement | undefined
  return (
    <div class="new-task-button-wrapper" classList={{ "new-task-button-wrapper--empty": !props.hasMessages }}>
      <div class="session-actions-row">
        {props.agents}
        <Show when={props.hasMessages && props.onNewSession}>
          <Tooltip value={language.t("sidebar.session.newSession.tooltip")} placement="top">
            <Button
              variant="secondary"
              size="small"
              class="session-new-button"
              onClick={() => props.onNewSession?.()}
              aria-label={language.t("sidebar.session.newSession")}
            >
              {language.t("sidebar.session.newSession")}
            </Button>
          </Tooltip>
        </Show>
        <Show when={props.branch}>
          {(branch) => (
            <div class="session-worktree-split" ref={worktreeRef}>
              <Tooltip value={worktreeTooltip} placement="top">
                <Button
                  variant="secondary"
                  size="small"
                  class="session-worktree-main"
                  onClick={props.onNewWorktree}
                  aria-label={language.t("sidebar.session.newWorktree")}
                >
                  {language.t("sidebar.session.newWorktree")}
                </Button>
              </Tooltip>
              <DropdownMenu gutter={4} placement="top-start" getAnchorRect={() => worktreeRef?.getBoundingClientRect()}>
                <Tooltip value={advancedTooltip} placement="top">
                  <DropdownMenu.Trigger
                    class="session-worktree-split-arrow"
                    aria-label={language.t("agentManager.worktree.advancedOptions")}
                  >
                    <Icon name="chevron-down" size="small" />
                  </DropdownMenu.Trigger>
                </Tooltip>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content class="session-worktree-split-menu">
                    <DropdownMenu.Item onSelect={() => props.onNewWorktreeFromBranch(branch())}>
                      <span class="session-worktree-menu-gap" aria-hidden="true" />
                      <DropdownMenu.ItemLabel class="session-worktree-menu-label">
                        <span>{language.t("sidebar.session.newWorktree.from")}</span>
                        <span class="session-worktree-menu-branch">
                          <Icon name="branch" size="small" />
                          <strong>{branch()}</strong>
                        </span>
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={props.onConfigureWorktree}>
                      <Icon name="settings-gear" size="small" />
                      <DropdownMenu.ItemLabel>
                        {language.t("agentManager.dialog.configureWorktree")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>
            </div>
          )}
        </Show>
        <Show when={props.hasMessages && props.branch && props.onMoveToWorktree}>
          <Tooltip value={moveTooltip()} placement="top">
            <Button
              variant="ghost"
              size="small"
              class="session-move-action"
              aria-disabled={props.moving}
              onClick={() => props.onMoveToWorktree?.()}
              aria-label={language.t("sidebar.session.moveToWorktree")}
            >
              <Show when={props.moving} fallback={<Icon name="branch" size="small" />}>
                <Spinner class="chat-spinner-small" />
              </Show>
              <span class="session-move-label">
                {props.moving ? props.moveDetail : language.t("sidebar.session.moveToWorktree")}
              </span>
            </Button>
          </Tooltip>
        </Show>
        <Show when={props.hasMessages && props.onShowChanges}>
          <Tooltip value={changesTooltip()} placement="top" class="session-move-changes-trigger">
            <Button
              variant="ghost"
              size="small"
              class="session-move-changes"
              classList={{
                "session-move-changes--empty": !props.stats?.files,
                "session-move-changes--has-changes": !!props.stats?.files,
              }}
              onClick={() => props.onShowChanges?.()}
              aria-label={language.t("command.session.show.changes")}
            >
              <Icon name="layers" size="small" />
              <Show when={props.stats?.files}>
                <span class="session-diff-add">
                  +<CountUp value={props.stats!.additions} from={start()} />
                </span>
                <span class="session-diff-del">
                  -<CountUp value={props.stats!.deletions} from={start()} />
                </span>
                <span class="session-move-dot" aria-hidden="true" />
              </Show>
            </Button>
          </Tooltip>
        </Show>
        {props.todos}
      </div>
    </div>
  )
}
