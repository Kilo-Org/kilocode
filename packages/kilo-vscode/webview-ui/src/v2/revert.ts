import type { PromptAttachment as MessageAttachment, SessionMessageInfo, SessionMessageUser } from "@opencode/client"
import { createSignal } from "solid-js"
import type { PromptAttachment } from "../../../src/protocol"
import { partFeedback, type BrowserReference } from "../../../src/shared/browser-feedback"
import { partInjected, withoutSource } from "../../../src/shared/injected-prompt"
import type { ReviewCommentEntry } from "../../../src/shared/review-comments"
import { fileName } from "../components/chat/prompt-input-utils"

export interface ComposerDraft {
  text: string
  items: PromptAttachment[]
  comments: ReviewCommentEntry[]
  browsers: BrowserReference[]
}

export const EMPTY_DRAFT: ComposerDraft = {
  text: "",
  items: [],
  comments: [],
  browsers: [],
}

/**
 * Revert and redo per session, as v1's checkpoint map: one mutation at a time for each session, other sessions stay
 * free, and new work waits for the latest settle. A send after the mutation started drops the restored draft, so the
 * old prompt never refills a composer the user already sent from.
 */
export function createRevertQueue() {
  const tasks = new Map<string, Promise<void>>()
  const sends = new Map<string, number>()
  const [busy, setBusy] = createSignal<ReadonlySet<string>>(new Set())
  const release = (id: string) =>
    setBusy((current) => new Set([...current].filter((item) => item !== id)))
  return {
    busy: (id: string | undefined) => !!id && busy().has(id),
    /** Resolves once the latest mutation of the session settled, whether it failed or not. */
    settled: (id: string | undefined) => (id && tasks.get(id)) || Promise.resolve(),
    /** Records a send to the session; call it before awaiting {@link settled}. */
    sent: (id: string | undefined) => {
      if (id) sends.set(id, (sends.get(id) ?? 0) + 1)
    },
    run<T>(id: string, mutate: () => Promise<T>, apply: (value: T) => void) {
      if (busy().has(id)) return undefined
      const sent = sends.get(id) ?? 0
      setBusy((current) => new Set([...current, id]))
      const task = mutate()
        .then((value) => {
          if ((sends.get(id) ?? 0) === sent) apply(value)
        })
        .finally(() => release(id))
      const settled = task.catch(() => undefined)
      tasks.set(id, settled)
      void settled.then(() => {
        if (tasks.get(id) !== settled) return
        tasks.delete(id)
        // Nothing of this session is in flight, so its send counter has done its job. This queue outlives tabs.
        sends.delete(id)
      })
      return task
    },
  }
}

/** Messages before the staged revert boundary. */
export function visibleMessages<T extends { id: string }>(
  messages: readonly T[],
  revert?: { messageID: string },
): T[] {
  if (!revert) return messages as T[]
  const index = messages.findIndex((item) => item.id === revert.messageID)
  if (index >= 0) return messages.slice(0, index)
  return messages.filter((item) => item.id < revert.messageID)
}

/** User messages at or after the staged revert boundary, in transcript order. */
export function revertedUserMessages(
  messages: readonly SessionMessageInfo[],
  revert?: { messageID: string },
): SessionMessageUser[] {
  if (!revert) return []
  const users = messages.filter((item): item is SessionMessageUser => item.type === "user")
  const index = users.findIndex((item) => item.id === revert.messageID)
  if (index >= 0) return users.slice(index)
  return users.filter((item) => item.id >= revert.messageID)
}

/** Reverted user prompt count displayed by the revert banner. */
export function revertedCount(
  messages: readonly SessionMessageInfo[],
  revert?: { messageID: string },
): number {
  if (!revert) return 0
  const users = messages.filter((item): item is SessionMessageUser => item.type === "user")
  const index = users.findIndex((item) => item.id === revert.messageID)
  if (index >= 0) return users.length - index
  return users.filter((item) => item.id > revert.messageID).length + 1
}

/** Next user message ID for a single-turn Redo, or undefined when Redo restores the whole session. */
export function nextRedoMessageID(
  messages: readonly SessionMessageInfo[],
  revert?: { messageID: string },
): string | undefined {
  if (!revert) return undefined
  const users = messages.filter((item): item is SessionMessageUser => item.type === "user")
  const index = users.findIndex((item) => item.id === revert.messageID)
  if (index >= 0) return users[index + 1]?.id
  return users.find((item) => item.id > revert.messageID)?.id
}

/**
 * What Redo does for the staged revert. The banner can show before the first transcript page lands, so an empty list
 * means loading, not "the last message": only a loaded transcript with nothing after the boundary means Redo All.
 */
export function redoTarget(
  messages: readonly SessionMessageInfo[],
  revert?: { messageID: string },
): { next: string } | "all" | undefined {
  if (!revert || messages.length === 0) return undefined
  const next = nextRedoMessageID(messages, revert)
  return next ? { next } : "all"
}

/** Rebuild the composer draft from a reverted user message, resolving server-stored media refs when needed. */
export async function restoredDraft(
  message: Pick<SessionMessageUser, "text" | "metadata"> & { readonly files?: readonly MessageAttachment[] },
  readMedia?: (uri: string) => Promise<Uint8Array | undefined>,
): Promise<ComposerDraft> {
  const injected = partInjected(message.metadata)
  const parsed = partFeedback(message.metadata, message.text)
  const text = injected
    ? injected.title.startsWith("/")
      ? injected.title
      : ""
    : withoutSource(parsed?.body ?? message.text)
  const files = message.files ?? []
  const items = (
    await Promise.all(files.map((file) => attachmentFromMessageFile(file, readMedia)))
  ).flatMap((item) => (item ? [item] : []))
  return {
    text,
    items,
    comments: parsed?.review?.comments ?? [],
    browsers: parsed?.browserFeedback?.references ?? [],
  }
}

async function attachmentFromMessageFile(
  file: MessageAttachment,
  readMedia?: (uri: string) => Promise<Uint8Array | undefined>,
): Promise<PromptAttachment | undefined> {
  if (file.mention && !file.mime.startsWith("image/")) return undefined
  const dataUrl = await resolveDataUrl(file, readMedia)
  if (file.mime.startsWith("image/")) {
    if (!dataUrl) return undefined
    return {
      id: crypto.randomUUID(),
      kind: "image",
      uri: dataUrl,
      name: file.name ?? "image",
      ...(file.description ? { description: file.description } : {}),
    }
  }
  if (file.source.type === "inline") {
    if (!dataUrl) return undefined
    return {
      id: crypto.randomUUID(),
      kind: file.name === "Terminal output" ? "terminal" : "selection",
      uri: dataUrl,
      name: file.name ?? "Attachment",
      ...(file.description ? { description: file.description } : {}),
    }
  }
  const range = file.description?.match(/^(.*), lines (\d+)(?:-\d+)?$/)
  if (range && dataUrl) {
    return {
      id: crypto.randomUUID(),
      kind: "selection",
      uri: dataUrl,
      name: file.name ?? range[1]!,
      description: file.description,
      source: file.source.uri,
      path: range[1]!,
      line: Number(range[2]),
    }
  }
  return {
    id: file.source.uri,
    kind: "file",
    uri: file.source.uri,
    name: file.name ?? fileName(file.source.uri),
    ...(file.description ? { description: file.description, path: file.description } : {}),
  }
}

async function resolveDataUrl(
  file: MessageAttachment,
  readMedia?: (uri: string) => Promise<Uint8Array | undefined>,
): Promise<string | undefined> {
  if ("data" in file) return `data:${file.mime};base64,${file.data}`
  const bytes = await readMedia?.(file.uri)
  if (!bytes) return undefined
  return `data:${file.mime};base64,${bytesToBase64(bytes)}`
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000
  const parts: string[] = []
  for (let index = 0; index < bytes.length; index += chunk) {
    parts.push(String.fromCharCode(...bytes.subarray(index, index + chunk)))
  }
  return btoa(parts.join(""))
}
