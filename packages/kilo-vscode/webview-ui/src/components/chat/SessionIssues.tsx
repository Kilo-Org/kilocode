import { For, Show, type Component } from "solid-js"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"
import type { SessionIssue } from "./session-issues"

interface Props {
  issues: SessionIssue[]
}

/**
 * Warning icon shown in the prompt toolbar when the current session has one
 * or more actionable issues (currently: MCP servers that need sign-in).
 * Hidden whenever there are no issues — that is the only hide condition,
 * matching the JetBrains session-issues menu this mirrors.
 *
 * Rendered as a single-level menu styled with VS Code's native menu tokens:
 * each issue contributes a group label followed by its actions, divided from
 * the next issue by a separator. A submenu per issue would add a second click
 * and, in the narrow sidebar, open a panel that overlaps its own trigger.
 */
export const SessionIssues: Component<Props> = (props) => {
  const language = useLanguage()

  return (
    <Show when={props.issues.length > 0}>
      <DropdownMenu gutter={4} placement="top">
        <Tooltip value={language.t("prompt.issues.title")} placement="top" openDelay={0}>
          <DropdownMenu.Trigger
            class="prompt-issues-button"
            aria-label={language.t("prompt.issues.title")}
            as={IconButton}
            icon="warning"
            variant="ghost"
            size="small"
          />
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="prompt-issues-menu">
            <For each={props.issues}>
              {(issue, index) => (
                <>
                  <Show when={index() > 0}>
                    <DropdownMenu.Separator />
                  </Show>
                  <DropdownMenu.Group>
                    <DropdownMenu.GroupLabel>{issue.title}</DropdownMenu.GroupLabel>
                    <For each={issue.actions}>
                      {(action) => (
                        <DropdownMenu.Item disabled={action.enabled === false} onSelect={action.run}>
                          <DropdownMenu.ItemLabel>{action.title}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      )}
                    </For>
                  </DropdownMenu.Group>
                </>
              )}
            </For>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  )
}
