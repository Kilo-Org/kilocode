import { For, Show, type Component } from "solid-js"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { Icon, type IconProps } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"

type Tone = "success" | "warning" | "error"

export interface OverflowItem {
  key: string
  icon: IconProps["name"]
  label: string
  /** The tooltip text of the toolbar button, so a folded action keeps its hint. */
  description?: string
  /** Icon color, the same as the toolbar button (for example indexing status). */
  tone?: Tone
  /** State that needs a dot on the menu button while the action is folded. */
  dot?: Tone
  /** Work in progress (for example enhance). Shows a spinner. */
  busy?: boolean
  disabled?: boolean
  run: () => void
}

interface Props {
  items: OverflowItem[]
}

const RANK: Record<Tone, number> = { success: 1, warning: 2, error: 3 }

/** The "..." button that holds the prompt actions folded out of the toolbar. */
export const PromptOverflow: Component<Props> = (props) => {
  const language = useLanguage()
  // The most important folded state wins: error, then warning, then an enabled toggle.
  const dot = () =>
    props.items.reduce<Tone | undefined>((best, item) => {
      if (!item.dot) return best
      if (!best || RANK[item.dot] > RANK[best]) return item.dot
      return best
    }, undefined)
  const busy = () => props.items.some((item) => item.busy)

  return (
    <DropdownMenu gutter={4} placement="top-end">
      <Tooltip value={language.t("prompt.action.more")} placement="top" openDelay={0}>
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          size="small"
          class="prompt-more-button"
          data-dot={dot()}
          data-busy={busy() ? "" : undefined}
          aria-label={language.t("prompt.action.more")}
        />
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="prompt-more-menu">
          <For each={props.items}>
            {(item) => (
              <DropdownMenu.Item disabled={item.disabled || item.busy} onSelect={item.run} data-tone={item.tone}>
                <span class="prompt-more-icon">
                  <Show when={item.busy} fallback={<Icon name={item.icon} size="small" />}>
                    <Spinner />
                  </Show>
                </span>
                <span class="prompt-more-text">
                  <DropdownMenu.ItemLabel>{item.label}</DropdownMenu.ItemLabel>
                  <Show when={item.description}>
                    <DropdownMenu.ItemDescription>{item.description}</DropdownMenu.ItemDescription>
                  </Show>
                </span>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
