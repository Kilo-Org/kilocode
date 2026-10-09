import { type Accessor, type Component, For } from "solid-js"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { type ApprovalMode, approvalMode, approvalRequest } from "./approval-mode"

interface Props {
  autoApprove: Accessor<boolean>
  approveForMe: Accessor<boolean>
}

const MODES: { mode: ApprovalMode; icon: "circle-check" | "gauge" | "shield" }[] = [
  { mode: "ask", icon: "circle-check" },
  { mode: "approveForMe", icon: "gauge" },
  { mode: "approveAll", icon: "shield" },
]

/**
 * Picks how permission prompts are handled: ask every time, approve for me
 * (experimental), or approve everything. Replaces the auto-approve shield while
 * the approve-for-me flag is on.
 */
export const ApprovalModeMenu: Component<Props> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const flags = () => ({ auto: props.autoApprove(), me: props.approveForMe() })
  const mode = () => approvalMode(flags())
  const tip = () =>
    `${language.t("prompt.approval.label")}: ${language.t(`prompt.approval.mode.${mode()}`)}${
      mode() === "approveAll" ? ` ${language.t("prompt.action.autoApprove.sandboxExcluded")}` : ""
    }`
  const icon = () => MODES.find((item) => item.mode === mode())!.icon

  const select = (next: ApprovalMode) => {
    for (const type of approvalRequest(flags(), next)) vscode.postMessage({ type })
  }

  return (
    <DropdownMenu placement="top-end" gutter={6}>
      <Tooltip value={tip()} placement="top" openDelay={0}>
        <DropdownMenu.Trigger
          as={IconButton}
          icon={icon()}
          variant="ghost"
          size="small"
          aria-label={language.t("prompt.approval.label")}
          class={`prompt-status-button ${mode() === "ask" ? "" : "prompt-status-button--active"}`}
        />
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.RadioGroup value={mode()} onChange={(value) => select(value as ApprovalMode)}>
            <For each={MODES}>
              {(item) => (
                <DropdownMenu.RadioItem value={item.mode} closeOnSelect>
                  <Icon name={item.icon} size="small" />
                  <DropdownMenu.ItemLabel>{language.t(`prompt.approval.mode.${item.mode}`)}</DropdownMenu.ItemLabel>
                  <DropdownMenu.ItemIndicator>
                    <Icon name="check-small" size="small" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              )}
            </For>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
