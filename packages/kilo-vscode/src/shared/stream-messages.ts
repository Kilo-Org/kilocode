/**
 * Wire types for the streaming part-update pipeline.
 *
 * Single source of truth shared by the extension-side scheduler
 * (`session-stream-scheduler.ts`) and the webview-side message types
 * (`webview-ui/src/types/messages.ts`). The generic `P` lets the webview
 * narrow `part` to its concrete `Part` union while the scheduler stays
 * payload-agnostic.
 */

export type PartTextDelta = { type: "text-delta"; textDelta: string }

export type PartUpdate<P = unknown> = {
  type: "partUpdated"
  sessionID: string
  messageID: string
  part: P
  delta?: PartTextDelta
}

export type PartBatch<P = unknown> = {
  type: "partsUpdated"
  updates: PartUpdate<P>[]
}
