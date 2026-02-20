import {
  createContext,
  useContext,
  createSignal,
  createMemo,
  onMount,
  onCleanup,
  ParentComponent,
  Accessor,
} from "solid-js"
import { useVSCode } from "./vscode"
import type { KilocodeNotification, ExtensionMessage } from "../types/messages"

interface NotificationsContextValue {
  notifications: Accessor<KilocodeNotification[]>
  filteredNotifications: Accessor<KilocodeNotification[]>
  dismiss: (id: string) => void
}

const NotificationsContext = createContext<NotificationsContextValue>()

export const NotificationsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [notifications, setNotifications] = createSignal<KilocodeNotification[]>([])
  const [dismissedIds, setDismissedIds] = createSignal<string[]>([])

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "notificationsLoaded") {
      setNotifications(message.notifications)
      setDismissedIds(message.dismissedIds)
    }
  })

  onMount(() => {
    let retries = 0
    const request = () => {
      vscode.postMessage({ type: "requestNotifications" })
    }
    request()
    const interval = setInterval(() => {
      if (notifications().length > 0 || retries >= 5) {
        clearInterval(interval)
        return
      }
      retries++
      request()
    }, 500)
    onCleanup(() => {
      clearInterval(interval)
      unsubscribe()
    })
  })

  const filteredNotifications = createMemo(() => {
    const dismissed = dismissedIds()
    return notifications().filter((n) => !dismissed.includes(n.id))
  })

  const dismiss = (id: string) => {
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
