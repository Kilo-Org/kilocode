import type { JsonValue } from "@opencode/client"
import { onCleanup } from "solid-js"
import type { PromptAttachment } from "../../../src/protocol"
import type { ComposerDraft } from "./revert"

/** Metadata a host request attaches to its prompt, for example the title of a prompt Kilo composed. */
type PromptMetadata = { [key: string]: JsonValue }

/** What the host may ask of the visible composer: editor and terminal context actions use it. */
export type ComposerHandle = {
  /** Adds context chips to the draft and focuses the composer. */
  attach: (items: PromptAttachment[]) => void
  /** Sends a prompt in the open session at once. The draft and its chips stay as they are. */
  submit: (text: string, items: PromptAttachment[], metadata?: PromptMetadata) => void
  /** Replaces the composer text, attachments, review comments and browser references, for revert and redo. */
  set?: (draft: ComposerDraft) => void
}

export type ComposerRequest =
  | { type: "attach"; items: PromptAttachment[] }
  | { type: "submit"; text: string; items: PromptAttachment[]; metadata?: PromptMetadata }

/**
 * Routes host requests to the composer while it exists and holds them while it does not, for example while the
 * sidebar shows History or the Agent Manager has no session open yet.
 */
export function createComposerQueue() {
  let handle: ComposerHandle | undefined
  let pending: ComposerRequest[] = []

  const run = (target: ComposerHandle, request: ComposerRequest) => {
    if (request.type === "attach") return target.attach(request.items)
    target.submit(request.text, request.items, request.metadata)
  }

  const ready = (next?: ComposerHandle) => {
    handle = next
    if (!next || pending.length === 0) return
    const requests = pending
    pending = []
    for (const request of requests) run(next, request)
  }

  const push = (request: ComposerRequest) => {
    if (handle) return run(handle, request)
    pending.push(request)
  }

  return { ready, push }
}

/** Hands the composer to its owner and clears it when the composer disposes. */
export function registerComposer(
  report: ((composer: ComposerHandle | undefined) => void) | undefined,
  composer: ComposerHandle,
) {
  report?.(composer)
  onCleanup(() => report?.(undefined))
}
