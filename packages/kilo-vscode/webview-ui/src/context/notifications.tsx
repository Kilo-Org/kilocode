// Kilo Gateway notifications for the empty session view. The server serves the list from the Kilo backend; the host
// keeps the dismissed IDs in global state, so every window hides the same items.
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  useContext,
  type Accessor,
  type ParentComponent,
} from "solid-js"
import { useV2 } from "../v2/client"
import { visibleNotifications } from "../v2/notification-list"
import { useVSCode } from "./vscode"

export interface NotificationsContextValue {
  notifications: Accessor<readonly KiloGatewayRpc.Notification[]>
  filteredNotifications: Accessor<readonly KiloGatewayRpc.Notification[]>
  dismiss: (id: string) => void
}

export const NotificationsContext = createContext<NotificationsContextValue>()

export const NotificationsProvider: ParentComponent = (props) => {
  const v2 = useV2()
  const vscode = useVSCode()
  const [notifications, setNotifications] = createSignal<readonly KiloGatewayRpc.Notification[]>([])
  const [dismissedIds, setDismissedIds] = createSignal<string[]>([])
  const location = { directory: v2.directory }
  const rpc = v2.api.rpc(KiloGatewayRpc.Definition)
  let read = 0

  const load = () => {
    const current = ++read
    void rpc
      .notifications({}, { location })
      .then((items) => {
        if (current === read) setNotifications(items)
      })
      // A failed fetch keeps the list shown, as on v1.
      .catch(() => undefined)
  }

  const release = vscode.onMessage((message) => {
    if (message.type === "dismissedNotificationsLoaded") setDismissedIds(message.ids)
  })
  onCleanup(release)

  createEffect(
    on(v2.connection.status, (status) => {
      if (status === "connected") load()
    }),
  )
  // Sign-in, sign-out and a team switch load a new Gateway account; ask again for the notifications it has.
  onCleanup(
    v2.data.on("provider.updated", (event) => {
      if (event.location?.directory === v2.directory) load()
    }),
  )
  vscode.postMessage({ type: "requestDismissedNotifications" })

  const filteredNotifications = createMemo(() => visibleNotifications(notifications(), dismissedIds()))

  const dismiss = (id: string) => {
    setDismissedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
    vscode.postMessage({ type: "dismissNotification", notificationId: id })
  }

  const value: NotificationsContextValue = {
    notifications,
    filteredNotifications,
    dismiss,
  }

  return <NotificationsContext.Provider value={value}>{props.children}</NotificationsContext.Provider>
}

export function useNotifications(): NotificationsContextValue {
  const context = useContext(NotificationsContext)
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationsProvider")
  }
  return context
}

/** The provider is sidebar-only; the Agent Manager renders its own welcome without notifications. */
export function useNotificationsOptional() {
  return useContext(NotificationsContext)
}
