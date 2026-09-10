/**
 * Feedback context
 *
 * Tracks per-message thumbs up/down ratings (in-memory only) and the VS Code
 * telemetry-enabled flag. The context exposes a single `rate()` callback that
 * updates local state and fires a telemetry event.
 *
 * State is not persisted — ratings reset on page reload / session switch.
 */

import { createContext, useContext, createSignal, onCleanup } from "solid-js"
import type { ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { ExtensionMessage } from "../types/messages"
import { TelemetryEventName } from "../../../src/services/telemetry/types"
import { buildFeedbackProperties, type Rating, type RateInput } from "./feedback-payload"

export type { Rating, RateInput } from "./feedback-payload"

interface FeedbackContextValue {
  telemetryEnabled: Accessor<boolean>
  getRating: (messageID: string) => Rating | undefined
  rate: (input: RateInput) => void
}

const FeedbackContext = createContext<FeedbackContextValue>()

export const FeedbackProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [telemetryEnabled, setTelemetryEnabled] = createSignal(false)
  const [ratings, setRatings] = createSignal<Record<string, Rating>>({})

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "telemetryState") return
    // Drop stored ratings if the user just revoked consent.
    if (telemetryEnabled() && !message.enabled) setRatings({})
    setTelemetryEnabled(message.enabled)
  })

  onCleanup(unsubscribe)

  const getRating = (messageID: string) => ratings()[messageID]

  const rate = (input: RateInput) => {
    if (!telemetryEnabled()) return
    const prev = ratings()[input.messageID]

    setRatings((current) => {
      const updated = { ...current }
      if (input.next === null) delete updated[input.messageID]
      else updated[input.messageID] = input.next
      return updated
    })

    vscode.postMessage({
      type: "telemetry",
      event: TelemetryEventName.FEEDBACK_SUBMITTED,
      properties: buildFeedbackProperties(input, prev),
    })
  }

  const value: FeedbackContextValue = { telemetryEnabled, getRating, rate }

  return <FeedbackContext.Provider value={value}>{props.children}</FeedbackContext.Provider>
}

export function useFeedback(): FeedbackContextValue {
  const context = useContext(FeedbackContext)
  if (!context) throw new Error("useFeedback must be used within a FeedbackProvider")
  return context
}
