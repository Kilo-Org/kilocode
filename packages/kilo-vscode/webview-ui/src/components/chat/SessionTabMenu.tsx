import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Show, type JSX, type ParentComponent } from "solid-js"
import { useLanguage } from "../../context/language"

export const SessionTabMenu: ParentComponent<{
  showFork?: boolean
  onFork?: () => void
  onClose: () => void
  onCloseOthers?: () => void
  closeable?: boolean
  closeShortcut?: JSX.Element
}> = (props) => {
  const { t } = useLanguage()
  return (
    <ContextMenu>
      <ContextMenu.Trigger as="div" style={{ display: "contents" }}>
        {props.children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content class="session-tab-menu am-ctx-menu">
          <Show when={props.showFork}>
            <ContextMenu.Item disabled={!props.onFork} onSelect={() => props.onFork?.()}>
              <Icon name="fork" size="small" />
              <ContextMenu.ItemLabel>{t("agentManager.tab.forkSession")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <Show when={props.closeable !== false || props.onCloseOthers}>
              <ContextMenu.Separator />
            </Show>
          </Show>
          <Show when={props.closeable !== false}>
            <ContextMenu.Item onSelect={props.onClose}>
              <Icon name="close" size="small" />
              <ContextMenu.ItemLabel>{t("agentManager.tab.close")}</ContextMenu.ItemLabel>
              {props.closeShortcut}
            </ContextMenu.Item>
          </Show>
          <Show when={props.onCloseOthers}>
            <ContextMenu.Item onSelect={() => props.onCloseOthers?.()}>
              <Icon name="close" size="small" />
              <ContextMenu.ItemLabel>{t("agentManager.tab.closeOthers")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </Show>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )
}
