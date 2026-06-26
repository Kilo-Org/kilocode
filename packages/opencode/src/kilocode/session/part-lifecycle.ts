import { MessageV2 } from "@/session/message-v2"

export namespace KiloPartLifecycle {
  export const key = "kilocode.lifecycle"

  export function transient(part: MessageV2.Part) {
    return part.type === "text" && part.metadata?.[key] === "transient"
  }
}
