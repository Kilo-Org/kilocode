// The seam every voice source implements. The orchestrator only ever talks to
// this interface, so fake voice, a scripted JSONL helper, and the Swift sidecar
// are interchangeable.

import type { VoiceCommand, VoiceEvent } from "./protocol"

export type VoiceAdapter = {
  /** Begin producing events. Resolves once the source is wired (not necessarily listening). */
  start(onEvent: (event: VoiceEvent) => void): Promise<void> | void
  /**
   * Inject a finalized turn directly. Implemented by fake voice (typed lines);
   * real sources that segment audio themselves leave this undefined.
   */
  inject?(text: string): void
  /** Send a control command to the source (no-op for sources that don't take input). */
  send?(cmd: VoiceCommand): void
  /** Drop any in-progress capture and return to a clean listening state. */
  reset(): void
  /** Tear down the source and release the mic / child process. */
  shutdown(): Promise<void> | void
}
