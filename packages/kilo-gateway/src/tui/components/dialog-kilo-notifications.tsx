// kilocode_change - new file
/**
 * Kilo Notifications Dialog
 *
 * Displays all notifications from Kilo API in a scrollable dialog.
 * Each notification shows title, message, and clickable action link.
 */

import { For } from "solid-js"
import { getTUIDependencies } from "../context.js"
import type { KilocodeNotification } from "../../api/notifications.js"

interface DialogKiloNotificationsProps {
  notifications: KilocodeNotification[]
}

export function DialogKiloNotifications(props: DialogKiloNotificationsProps) {
  const deps = getTUIDependencies()
  const Link = deps.Link
  const TextAttributes = deps.TextAttributes
  const dialog = deps.useDialog()
  const { theme } = deps.useTheme()

  deps.useKeyboard((evt: any) => {
    if (evt.name === "escape" || evt.name === "return") {
      dialog.clear()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          News
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <scrollbox maxHeight={15} flexGrow={1}>
        <box gap={2} paddingBottom={1}>
          <For each={props.notifications}>
            {(notification) => (
              <box gap={0}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.info}>*</text>
                  <text attributes={TextAttributes.BOLD} fg={theme.text}>
                    {notification.title}
                  </text>
                </box>
                <box paddingLeft={2}>
                  <text fg={theme.textMuted} wrapMode="word">
                    {notification.message}
                  </text>
                  {notification.action && (
                    <box flexDirection="row" marginTop={1}>
                      <Link href={notification.action.actionURL} fg={theme.primary}>
                        [{notification.action.actionText}]
                      </Link>
                    </box>
                  )}
                </box>
              </box>
            )}
          </For>
        </box>
      </scrollbox>
    </box>
  )
}
