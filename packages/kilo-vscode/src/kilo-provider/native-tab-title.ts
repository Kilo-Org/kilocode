import type { Session } from "@kilocode/sdk/v2/client"
import type { Activity } from "../../webview-ui/src/utils/session-activity"
import { EXTENSION_DISPLAY_NAME } from "../constants"
import { isPlaceholderTitle } from "../shared/session-title"

const TITLE_LIMIT = 19
const icons: Record<Activity, string> = {
  idle: "",
  busy: "◔",
  retry: "◔",
  waiting: "⚠",
  error: "⚠",
  done: "✓",
  scheduled: "◷",
}

export const nativeTitle = (session: Session | null, state: Activity = "idle", label?: string) => {
  const value = session?.title?.trim()
  const title = label ?? (isPlaceholderTitle(value) ? EXTENSION_DISPLAY_NAME : value!)
  const text = label || title.length <= TITLE_LIMIT ? title : `${title.slice(0, TITLE_LIMIT)}...`
  return icons[state] ? `${icons[state]} ${text}` : text
}
