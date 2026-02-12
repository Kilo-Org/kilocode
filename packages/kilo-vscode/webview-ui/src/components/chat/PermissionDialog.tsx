/**
 * PermissionDialog component
 * Displays permission requests from the assistant and allows user to respond.
 *
 * Uses the same component pattern as the desktop app (packages/app/src/pages/session.tsx):
 * BasicTool for the collapsible tool header, and data-component="permission-prompt"
 * with data-slot="permission-actions" for the button row (styled by kilo-ui CSS).
 */

import { Component, For, Show, createEffect, on } from "solid-js"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Button } from "@kilocode/kilo-ui/button"
import { BasicTool } from "@kilocode/kilo-ui/basic-tool"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import type { PermissionRequest } from "../../types/messages"

interface PermissionItemProps {
  permission: PermissionRequest
}

const PermissionItem: Component<PermissionItemProps> = (props) => {
  const session = useSession()
  const language = useLanguage()

  const handleResponse = (response: "once" | "always" | "reject") => {
    session.respondToPermission(props.permission.id, response)
  }

  return (
    <div data-component="tool-part-wrapper" data-permission="true">
      <BasicTool
        icon="checklist"
        locked
        defaultOpen
        trigger={{
          title: props.permission.toolName,
        }}
      >
        <Show when={props.permission.args}>
          <div class="permission-details">
            <pre>{JSON.stringify(props.permission.args, null, 2)}</pre>
          </div>
        </Show>
      </BasicTool>
      <div data-component="permission-prompt">
        <div data-slot="permission-actions">
          <Button variant="ghost" size="small" onClick={() => handleResponse("reject")}>
            {language.t("ui.permission.deny")}
          </Button>
          <Button variant="secondary" size="small" onClick={() => handleResponse("always")}>
            {language.t("ui.permission.allowAlways")}
          </Button>
          <Button variant="primary" size="small" onClick={() => handleResponse("once")}>
            {language.t("ui.permission.allowOnce")}
          </Button>
        </div>
      </div>
    </div>
  )
}

export const PermissionDialog: Component = () => {
  const session = useSession()
  const dialog = useDialog()
  const language = useLanguage()

  const permissions = () => session.permissions()
  const hasPermissions = () => permissions().length > 0

  // Reactively show/hide the dialog based on pending permissions.
  // useDialog().show() internally wraps the Dialog in a Kobalte root + portal
  // from the same package copy, avoiding the dual-package context mismatch.
  createEffect(
    on(hasPermissions, (has) => {
      if (has) {
        dialog.show(() => (
          <Dialog title={language.t("notification.permission.title")} fit action={<span />}>
            <For each={permissions()}>{(permission) => <PermissionItem permission={permission} />}</For>
          </Dialog>
        ))
      } else {
        dialog.close()
      }
    }),
  )

  return null
}
