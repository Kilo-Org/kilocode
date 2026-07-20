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

/**
 * Incremental tool-call argument fragments (server `message.part.delta` with
 * `field: "raw"`). Streamed while the model is still generating a tool call's
 * arguments, so pending tool cards can show live input progress instead of
 * sitting frozen for the many seconds a large write/edit takes to generate.
 */
export type PartToolInputDelta = { type: "tool-input-delta"; textDelta: string }

export type PartUpdate<P = unknown> = {
  type: "partUpdated"
  sessionID: string
  messageID: string
  part: P
  delta?: PartTextDelta | PartToolInputDelta
}

export type PartBatch<P = unknown> = {
  type: "partsUpdated"
  updates: PartUpdate<P>[]
}

export type PartRemove = {
  type: "partRemoved"
  sessionID: string
  messageID: string
  partID: string
}
