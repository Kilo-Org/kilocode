import { validateHookInput } from "../utils/validation"
import { LOG_PREFIX } from "../constants"

export function createEventHook() {
  return async ({ event }: { event: any }) => {
    const validation = validateHookInput("event", { event })
    if (!validation.isValid) {
      console.error(`${LOG_PREFIX} Invalid event input:`, validation.errors)
      return
    }

    if (event.type === "session.created" || event.type === "session.updated") {
      // reserved for future health hooks
    }
  }
}
