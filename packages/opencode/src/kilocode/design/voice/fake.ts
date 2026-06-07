// Fake voice source: typed lines stand in for spoken utterances. This is a real
// product component (used for `--voice fake`, tests, and dev), not a test mock —
// it drives the exact same event path as the Swift sidecar.

import type { VoiceAdapter } from "./adapter"
import type { VoiceEvent } from "./protocol"

export function createFakeVoice(): VoiceAdapter {
  let emit: ((event: VoiceEvent) => void) | undefined
  return {
    start(onEvent) {
      emit = onEvent
      // Fake voice is "listening" the moment it starts — no permission prompt.
      emit({ type: "state", value: "listening" })
    },
    inject(text) {
      const trimmed = text.trim()
      if (!trimmed || !emit) return
      // Mirror the real source's shape: a brief processing blip, then a turn,
      // then back to listening.
      emit({ type: "state", value: "processing" })
      emit({ type: "turn", text: trimmed })
      emit({ type: "state", value: "listening" })
    },
    reset() {
      emit?.({ type: "partial", text: "" })
      emit?.({ type: "state", value: "listening" })
    },
    shutdown() {
      emit = undefined
    },
  }
}
