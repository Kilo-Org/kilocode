import type { IconProps } from "@kilocode/kilo-ui/icon"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { Show, type Component, type JSX } from "solid-js"
import { SessionTabMenu } from "../src/components/chat/SessionTabMenu"
import { SortableTabContainer } from "../src/components/chat/TabDnd"
import { useLanguage } from "../src/context/language"
import { parseBindingTokens } from "./keybind-tokens"

type TabIcon = IconProps["name"] | "spinner"
type Value<T> = T | (() => T)

function value<T>(input: Value<T>): T {
  return typeof input === "function" ? (input as () => T)() : input
}

export interface ClosableTabProps {
  id?: string
  label: Value<string>
  tooltip: Value<string>
  icon: Value<TabIcon>
  iconStatus?: Value<"success" | "failure" | undefined>
  class?: string
  focused?: boolean
  active: boolean
  closeable?: boolean
  showKeybind?: boolean
  keybind?: string
  closeKeybind?: string
  role?: "tab"
  selected?: boolean
  tabIndex?: number
  onKeyDown?: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent>
  onSelect: () => void
  onMiddleClick?: (event: MouseEvent) => void
  onClose: () => void
  trailing?: JSX.Element
}

export const ClosableTabChrome: Component<ClosableTabProps> = (props) => {
  const { t } = useLanguage()
  const label = () => value(props.label)
  const tooltip = () => value(props.tooltip)
  const icon = () => value(props.icon)
  const status = () => (props.iconStatus ? value(props.iconStatus) : undefined)
  const keybind = () => (props.showKeybind === false ? "" : (props.keybind ?? ""))
  const closeKeybind = () => (props.showKeybind === false ? "" : (props.closeKeybind ?? ""))
  return (
    <div
      class={`am-tab am-tab-closable ${props.active ? "am-tab-active" : ""} ${props.focused ? "am-tab-focused" : ""} ${props.class ?? ""}`}
    >
      <div
        class="am-tab-target"
        role={props.role}
        aria-selected={props.selected}
        aria-label={tooltip()}
        tabIndex={props.tabIndex}
        onClick={props.onSelect}
        onMouseDown={props.onMiddleClick}
        onKeyDown={props.onKeyDown}
      >
        <TooltipKeybind
          title={tooltip()}
          keybind={keybind()}
          placement="bottom"
          gutter={8}
          class="am-tab-tooltip"
          openDelay={0}
        >
          <span class="am-tab-title">
            <span class="am-tab-icon" data-run-status={status()}>
              <Show when={icon() === "spinner"} fallback={<Icon name={icon() as IconProps["name"]} size="small" />}>
                <Spinner class="am-tab-spinner" />
              </Show>
            </span>
            <span class="am-tab-label">{label()}</span>
          </span>
        </TooltipKeybind>
      </div>
      {props.trailing}
      <Show when={props.closeable !== false}>
        <TooltipKeybind
          title={t("agentManager.tab.close")}
          keybind={closeKeybind()}
          placement="top"
          gutter={8}
          class="am-tab-close-wrap"
          openDelay={0}
        >
          <IconButton
            icon="close-small"
            size="small"
            variant="ghost"
            aria-label={t("agentManager.tab.closeTab")}
            tabIndex={props.active ? 0 : -1}
            class="am-tab-close"
            data-tab-close="true"
            onClick={(event) => {
              event.stopPropagation()
              props.onClose()
            }}
          />
        </TooltipKeybind>
      </Show>
    </div>
  )
}

export const SortableClosableTab: Component<
  ClosableTabProps & {
    id: string
    onCloseOthers: () => void
  }
> = (props) => (
  <SortableTabContainer id={props.id}>
    <SessionTabMenu
      onClose={props.onClose}
      onCloseOthers={props.onCloseOthers}
      closeable={props.closeable}
      closeShortcut={
        props.closeKeybind ? (
          <span class="am-menu-shortcut">
            {parseBindingTokens(props.closeKeybind).map((token) => (
              <kbd class="am-menu-key">{token}</kbd>
            ))}
          </span>
        ) : undefined
      }
    >
      <ClosableTabChrome
        label={props.label}
        tooltip={props.tooltip}
        icon={props.icon}
        iconStatus={props.iconStatus}
        class={props.class}
        focused={props.focused}
        active={props.active}
        closeable={props.closeable}
        showKeybind={props.showKeybind}
        keybind={props.keybind}
        closeKeybind={props.closeKeybind}
        role={props.role}
        selected={props.selected}
        tabIndex={props.tabIndex}
        onKeyDown={props.onKeyDown}
        onSelect={props.onSelect}
        onMiddleClick={props.onMiddleClick}
        onClose={props.onClose}
        trailing={props.trailing}
      />
    </SessionTabMenu>
  </SortableTabContainer>
)
