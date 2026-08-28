import type { Session } from "@kilocode/sdk/v2/client"
import type { Activity } from "../../webview-ui/src/utils/session-activity"
import { EXTENSION_DISPLAY_NAME } from "../constants"

const DEFAULT_SESSION_TITLE = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const TITLE_LIMIT = 19
const icons: Record<Activity, string> = {
  idle: "",
  busy: "◔",
  retry: "◔",
  waiting: "⚠",
  error: "⚠",
  done: "✓",
}

export const nativeTitle = (session: Session | null, state: Activity = "idle", label?: string) => {
  const value = session?.title?.trim()
  const title = label ?? (!value || DEFAULT_SESSION_TITLE.test(value) ? EXTENSION_DISPLAY_NAME : value)
  const text = label || title.length <= TITLE_LIMIT ? title : `${title.slice(0, TITLE_LIMIT)}...`
  return icons[state] ? `${icons[state]} ${text}` : text
}
