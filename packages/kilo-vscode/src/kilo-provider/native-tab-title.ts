import type { Session } from "@kilocode/sdk/v2/client"
import { EXTENSION_DISPLAY_NAME } from "../constants"

const DEFAULT_SESSION_TITLE = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const TITLE_LIMIT = 19

export const nativeTitle = (session: Session | null) => {
  const title = session?.title?.trim()
  if (!title || DEFAULT_SESSION_TITLE.test(title)) return EXTENSION_DISPLAY_NAME
  if (title.length <= TITLE_LIMIT) return title
  return `${title.slice(0, TITLE_LIMIT)}...`
}
