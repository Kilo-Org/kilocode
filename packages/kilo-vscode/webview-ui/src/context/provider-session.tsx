import type { ParentComponent } from "solid-js"
import { NotificationsProvider } from "./notifications"
import { SessionProvider } from "./session"

export const Session: ParentComponent = (props) => (
  <NotificationsProvider>
    <SessionProvider>{props.children}</SessionProvider>
  </NotificationsProvider>
)
