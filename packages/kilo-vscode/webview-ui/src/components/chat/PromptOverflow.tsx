import { For, type Component } from "solid-js"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { Icon, type IconProps } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"

export interface OverflowItem {
  key: string
  icon: IconProps["name"]
  label: string
  disabled?: boolean
  /** The action has an on state (for example auto-approve is enabled). */
  active?: boolean
  run: () => void
}

interface Props {
  items: OverflowItem[]
}

/** The "..." button that holds the prompt actions folded out of the toolbar. */
export const PromptOverflow: Component<Props> = (props) => {
  const language = useLanguage()
  const active = () => props.items.some((item) => item.active)

  return (
    <DropdownMenu gutter={4} placement="top-end">
      <Tooltip value={language.t("prompt.action.more")} placement="top" openDelay={0}>
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          size="small"
          class="prompt-more-button"
          data-active={active() ? "" : undefined}
          aria-label={language.t("prompt.action.more")}
        />
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="prompt-more-menu">
          <For each={props.items}>
            {(item) => (
              <DropdownMenu.Item
                disabled={item.disabled}
                onSelect={item.run}
                data-active={item.active ? "" : undefined}
              >
                <span class="prompt-more-icon">
                  <Icon name={item.icon} size="small" />
                </span>
                <DropdownMenu.ItemLabel>{item.label}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
