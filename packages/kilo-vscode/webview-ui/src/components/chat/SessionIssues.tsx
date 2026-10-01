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
          <DropdownMenu.Content>
            <For each={props.issues}>
              {(issue) => (
                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger>{issue.title}</DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent>
                      <For each={issue.actions}>
                        {(action) => (
                          <DropdownMenu.Item disabled={action.enabled === false} onSelect={action.run}>
                            <DropdownMenu.ItemLabel>{action.title}</DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                        )}
                      </For>
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
              )}
            </For>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  )
}
