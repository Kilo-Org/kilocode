// kilocode_change - new file
/**
 * Kilo Notifications Dialog
 *
 * Displays all notifications from Kilo API in a scrollable dialog.
 * Each notification shows title, message, and clickable action link.
 */

import { createSignal, For } from "solid-js"
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
  const [closeHover, setCloseHover] = createSignal(false)

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
        <box
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={closeHover() ? theme.backgroundElement : undefined}
          onMouseOver={() => setCloseHover(true)}
          onMouseOut={() => setCloseHover(false)}
          onMouseUp={() => dialog.clear()}
        >
          <text fg={closeHover() ? theme.text : theme.textMuted}>esc</text>
        </box>
      </box>
      <scrollbox maxHeight={15} flexGrow={1}>
        <box gap={0} paddingBottom={1}>
          <For each={props.notifications}>
            {(notification) => {
              const [hover, setHover] = createSignal(false)

              return (
                <box
                  gap={0}
                  backgroundColor={hover() ? theme.backgroundElement : undefined}
                  paddingTop={1}
                  paddingBottom={1}
                  paddingLeft={2}
                  paddingRight={2}
                  onMouseOver={() => setHover(true)}
                  onMouseOut={() => setHover(false)}
                >
                  <box flexDirection="row" gap={1}>
                    <text fg={hover() ? theme.primary : theme.info}>*</text>
                    <text attributes={TextAttributes.BOLD} fg={hover() ? theme.primary : theme.text}>
                      {notification.title}
                    </text>
                  </box>
                  <box paddingLeft={2}>
                    <text fg={hover() ? theme.text : theme.textMuted} wrapMode="word">
                      {notification.message}
                    </text>
                    {notification.action && (
                      <box flexDirection="row" marginTop={1}>
                        <Link
                          href={notification.action.actionURL}
                          fg={theme.primary}
                          attributes={hover() ? TextAttributes.BOLD : undefined}
                        >
                          [{notification.action.actionText}]
                        </Link>
                      </box>
                    )}
                  </box>
                </box>
              )
            }}
          </For>
        </box>
      </scrollbox>
    </box>
  )
}
