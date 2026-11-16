/**
 * The send a context action asks for. `enter` is what a plain click stands for, `alternate` what an Option-click
 * stands for, mirroring Enter and ⌥↵ in the composer. The action does not know whether a turn is running, so the
 * composer resolves the intent into its delivery.
 */
export type SendIntent = "enter" | "alternate"

/** What a plain Enter does while the agent runs (`kilo-code.v2.chat.sendWhileRunning`). Alt+Enter does the other. */
export type Delivery = "steer" | "queue"

/** The send intent of a click: Option-click is the alternate send, a plain click is Enter's. */
export function clickSend(event: { altKey?: boolean }): SendIntent {
  return event.altKey ? "alternate" : "enter"
}

/** Resolves a click's send intent into the server inbox delivery for the target session. */
export function intentDelivery(intent: SendIntent, running: boolean, preferred: Delivery = "steer"): Delivery {
  if (!running) return "steer"
  if (intent === "alternate") return preferred === "steer" ? "queue" : "steer"
  return preferred
}
