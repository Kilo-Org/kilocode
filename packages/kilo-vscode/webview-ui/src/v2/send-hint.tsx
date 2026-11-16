import { For, type JSX } from "solid-js"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../context/language"
import { runningDelivery } from "./kilo-settings"
import { other } from "./pending-actions"
import { alternateClickKey, sendHintRows } from "./send-hint-text"

/**
 * The tooltip of every button that hands content to Kilo. It always names the delivery an Option-click sends with,
 * so the buttons agree with each other and with the composer's Enter and ⌥↵.
 */
export function SendHint(props: {
  title: string
  keybind?: string
  alternateKeybind?: string
  /** False for an action that does not reach the composer, such as a terminal target: no delivery hint. */
  alternate?: boolean
  /** Renders the children without a tooltip, for a button whose label already names another destination. */
  inactive?: boolean
  /** Keeps the hint open, for stories and render checks. */
  forceOpen?: boolean
  placement?: "top" | "bottom" | "left" | "right"
  children: JSX.Element
}) {
  const language = useLanguage()
  const click = () => language.t("prompt.action.click")
  const alternateClick = () => alternateClickKey(language.t)
  const rows = () =>
    sendHintRows({
      title: props.title,
      keybind: props.keybind,
      alternateKeybind: props.alternateKeybind,
      click: click(),
      alternateClick: alternateClick(),
      alternate: props.alternate === false ? undefined : other(runningDelivery()),
      t: language.t,
    })
  return (
    <Tooltip
      placement={props.placement ?? "top"}
      inactive={props.inactive}
      forceOpen={props.forceOpen}
      value={
        <div class="send-hint">
          <For each={rows()}>
            {(row) => (
              <div data-slot="tooltip-keybind">
                <span>{row.action}</span>
                <span data-slot="tooltip-keybind-key">{row.keys}</span>
              </div>
            )}
          </For>
        </div>
      }
    >
      {props.children}
    </Tooltip>
  )
}
