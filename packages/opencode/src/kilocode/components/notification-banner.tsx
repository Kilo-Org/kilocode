// kilocode_change - new file
/**
 * Kilo Notification Banner
 *
 * Displays a notification teaser on the home screen.
 * Clicking opens the full notifications dialog.
 *
 * Layout:
 *   ● Title (N new)
 *     Message text with word wrap...
 */

import { createSignal, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import type { KilocodeNotification } from "@kilocode/kilo-gateway"

interface NotificationBannerProps {
  notification: KilocodeNotification
  totalCount: number
  onClick?: () => void
}

export function NotificationBanner(props: NotificationBannerProps) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)

  return (
    <box
      flexDirection="column"
      maxWidth="100%"
      backgroundColor={hover() ? theme.backgroundElement : undefined}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={props.onClick}
    >
      {/* Line 1: Icon + Title + Count */}
      <box flexDirection="row" gap={1}>
        <text flexShrink={0} style={{ fg: hover() ? theme.primary : theme.info }}>
          ●
        </text>
        <text wrapMode="none" style={{ fg: hover() ? theme.primary : theme.text }}>
          {props.notification.title}
        </text>
        <Show when={props.totalCount > 1}>
          <text flexShrink={0} style={{ fg: hover() ? theme.primary : theme.textMuted }}>
            ({props.totalCount} new)
          </text>
        </Show>
      </box>

      {/* Line 2: Message (indented to align under title) */}
      <box paddingLeft={2}>
        <text style={{ fg: hover() ? theme.text : theme.textMuted }} wrapMode="word">
          {props.notification.message}
        </text>
      </box>
    </box>
  )
}
