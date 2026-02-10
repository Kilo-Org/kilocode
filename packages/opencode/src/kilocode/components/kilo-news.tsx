// kilocode_change - new file
/**
 * Kilo News Component
 *
 * Self-contained component that fetches and displays Kilo news/notifications.
 * Shows a banner on the home screen; clicking opens a dialog with all news items.
 */

import { createEffect, createMemo, createSignal, on, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import type { KilocodeNotification } from "@kilocode/kilo-gateway"
import { NotificationBanner } from "./notification-banner.js"
import { DialogKiloNotifications } from "./dialog-kilo-notifications.js"

export function KiloNews() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()

  const [notifications, setNotifications] = createSignal<KilocodeNotification[]>([])
  const [fetched, setFetched] = createSignal(false)
  const isKiloConnected = createMemo(() => sync.data.provider_next.connected.includes("kilo"))

  const openNewsDialog = () => {
    const items = notifications()
    if (items.length > 0) {
      dialog.replace(() => <DialogKiloNotifications notifications={items} />)
    }
  }

  // Reactively wait for sync to complete, then fetch notifications once
  createEffect(
    on(
      () => sync.status,
      async (status) => {
        if (status !== "complete") return
        if (fetched()) return
        setFetched(true)

        if (!isKiloConnected()) return

        const result = await sdk.client.kilo.notifications()
        const items = result.data
        if (items && items.length > 0) {
          setNotifications(items)
        }
      },
    ),
  )

  // Always render the container to reserve layout space and prevent shift.
  // The banner content appears once notifications are loaded; the fixed-height
  // placeholder keeps the surrounding elements stable during the async fetch.
  return (
    <Show when={notifications().length > 0} fallback={<box height={3} />}>
      <NotificationBanner
        notification={notifications()[0]}
        totalCount={notifications().length}
        onClick={openNewsDialog}
      />
    </Show>
  )
}
