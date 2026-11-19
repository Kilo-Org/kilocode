import { For, Show } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import type { OpenCodeClient } from "@opencode/client"
import { useLanguage } from "../../src/context/language"
import { CloudManagementDialog, type CloudManagementAction } from "./management"
import { CloudPreviewDialog } from "./preview"
import { ForkDialog, SnapshotDialog } from "./fork-share"
import type { ChatRoute, CloudNavigation } from "./route"
import { focusCloudChat } from "./focus"
import { createTabMenuAction } from "../../src/utils/tab-navigation"

export function SessionMenu(props: {
  route: ChatRoute
  api: OpenCodeClient
  nav: CloudNavigation
  refresh: () => void
}) {
  const { t } = useLanguage()
  const dialog = useDialog()
  const menu = createTabMenuAction()
  const sessionAction = (action: "fork" | "share") => {
    const route = props.route
    const Component = action === "fork" ? ForkDialog : SnapshotDialog
    dialog.show(() => (
      <Component api={props.api} nav={props.nav} route={route} close={() => dialog.close()} refresh={props.refresh} />
    ))
  }
  const open = (action: CloudManagementAction) => {
    const route = props.route
    dialog.show(() => (
      <CloudManagementDialog
        api={props.api}
        route={route}
        action={action}
        onClose={() => dialog.close()}
        onRenamed={(title) => {
          props.nav.renamed(route, title)
          props.refresh()
        }}
        onDeleted={() => {
          props.nav.removed(route)
          props.refresh()
        }}
      />
    ))
  }
  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenu.Trigger
        as={IconButton}
        icon="ellipsis"
        size="small"
        variant="ghost"
        aria-label={t("agentManager.tab.newOptions")}
        data-cloud-session-menu=""
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="am-split-menu" onCloseAutoFocus={menu.close}>
          <DropdownMenu.Item onSelect={() => sessionAction("fork")}>
            <DropdownMenu.ItemLabel>{t("agentManager.tab.forkSession")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => sessionAction("share")}>
            <DropdownMenu.ItemLabel>{t("agentManager.cloud.share.title")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => {
              const route = props.route
              dialog.show(() => <CloudPreviewDialog api={props.api} route={route} close={() => dialog.close()} />)
            }}
          >
            <DropdownMenu.ItemLabel>{t("agentManager.pr.comment.preview")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => open("info")}>
            <DropdownMenu.ItemLabel>{t("error.details.show")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => open("rename")}>
            <DropdownMenu.ItemLabel>{t("common.rename")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => open("delete")}>
            <DropdownMenu.ItemLabel>{t("session.delete.title")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <Show when={props.nav.closed().length}>
            <DropdownMenu.Separator />
            <DropdownMenu.Group>
              <DropdownMenu.GroupLabel>{t("agentManager.history.title")}</DropdownMenu.GroupLabel>
              <For each={props.nav.closed()}>
                {(r) => (
                  <DropdownMenu.Item
                    data-restore-session={r.target.sessionID}
                    onSelect={() =>
                      menu.select(() => {
                        if (props.nav.current() !== props.route) return
                        props.nav.select(r)
                        focusCloudChat()
                      })
                    }
                  >
                    <DropdownMenu.ItemLabel>{r.title}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                )}
              </For>
            </DropdownMenu.Group>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
