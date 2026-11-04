import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../src/context/language"

interface Props {
  collapsed: boolean
  onClick: () => void
}

/**
 * Sidebar collapse/expand toggle rendered inside the tab bar's leading slot.
 * Same pixel position in both states; only the icon's left-column fill flips
 * to indicate state.
 */
export function SidebarToggleButton(props: Props) {
  const { t } = useLanguage()
  const label = () => (props.collapsed ? t("agentManager.sidebar.expand") : t("agentManager.sidebar.collapse"))
  return (
    <Tooltip value={label()} placement="bottom">
      <IconButton
        icon={props.collapsed ? "layout-left-partial" : "layout-left-full"}
        size="small"
        variant="ghost"
        label={label()}
        onClick={props.onClick}
      />
    </Tooltip>
  )
}
