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

// Static notifications always shown unconditionally (not fetched from API)
const STATIC_NOTIFICATIONS: KilocodeNotification[] = [
  {
    id: "star-giveaway-june-2026",
    title: "GitHub Star Giveaway",
    message: "We're giving away $500 of AI Credits when we reach 25,000 stars on GitHub. Support us:",
    action: { actionText: "github.com/Kilo-Org/kilocode", actionURL: "https://github.com/Kilo-Org/kilocode/" },
  },
]

interface NotificationsContextValue {
  notifications: Accessor<KilocodeNotification[]>
  filteredNotifications: Accessor<KilocodeNotification[]>
  dismiss: (id: string) => void
}

export const NotificationsContext = createContext<NotificationsContextValue>()

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
    const all = [...STATIC_NOTIFICATIONS, ...notifications()]
    return all.filter((n) => !dismissed.includes(n.id))
  })

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
