import { batch, type Accessor } from "solid-js"
import type { SetStoreFunction, Store } from "solid-js/store"
import type {
  PromptInputV2AgentPart,
  PromptInputV2Attachment,
  PromptInputV2Comment,
  PromptInputV2FilePart,
  PromptInputV2Model,
  PromptInputV2PersistedState,
  PromptInputV2Prompt,
} from "./types"

export type PromptInputV2StoreTuple = [
  Store<PromptInputV2PersistedState> | Accessor<Store<PromptInputV2PersistedState>>,
  SetStoreFunction<PromptInputV2PersistedState>,
]

export type PromptInputV2StoreInput = PromptInputV2StoreTuple | Accessor<PromptInputV2StoreTuple>

export function createPromptInputV2Store(input: PromptInputV2StoreInput) {
  const tuple = () => (typeof input === "function" ? input() : input)
  const store = () => {
    const value = tuple()[0]
    return typeof value === "function" ? value() : value
  }
  const setStore = () => tuple()[1]

  return {
    get state() {
      return store()
    },
    setPrompt(prompt: PromptInputV2Prompt, cursor?: number) {
      release(store().prompt, prompt) // kilocode_change - release locally owned attachments removed by replacement
      batch(() => {
        setStore()("prompt", prompt)
        if (cursor !== undefined) setStore()("cursor", cursor)
      })
    },
    setCursor(cursor: number) {
      setStore()("cursor", cursor)
    },
    setText(content: string) {
      batch(() => {
        setStore()("prompt", (prompt) => replaceText(prompt, content)) // kilocode_change - preserve mention ordering
        setStore()("cursor", content.length)
      })
    },
    addText(content: string) {
      const cursor = store().cursor ?? promptLength(store().prompt)
      batch(() => {
        setStore()("prompt", (prompt) => insertText(prompt, cursor, content))
        setStore()("cursor", cursor + content.length)
      })
    },
    reset() {
      release(store().prompt) // kilocode_change - release locally owned attachment URLs on reset
      batch(() => {
        setStore()("prompt", [{ type: "text", content: "", start: 0, end: 0 }])
        setStore()("cursor", 0)
      })
    },
    setModel(model: PromptInputV2Model | undefined) {
      setStore()("model", model)
    },
    setVariant(variant: string | null) {
      if (store().model) setStore()("model", "variant", variant)
    },
    addContext(item: PromptInputV2Comment) {
      if (store().context.items.some((entry) => entry.key === item.key)) return
      setStore()("context", "items", (items) => [...items, item])
    },
    removeContext(key: string) {
      setStore()("context", "items", (items) => items.filter((item) => item.key !== key))
    },
    addMention(mention: PromptInputV2FilePart | PromptInputV2AgentPart) {
      const text = store()
        .prompt.map((part) => ("content" in part ? part.content : ""))
        .join("")
      const end = store().cursor ?? text.length
      const start = text.slice(0, end).lastIndexOf("@")
      setStore()("prompt", insertMention(store().prompt, start < 0 ? end : start, end, mention))
      setStore()("cursor", (start < 0 ? end : start) + mention.content.length + 1)
    },
    addAttachment(attachment: PromptInputV2Attachment) {
      setStore()("prompt", (prompt) => [...prompt, attachment])
    },
    removeAttachment(id: string) {
      const attachment = store().prompt.find((part) => part.type === "image" && part.id === id)
      if (attachment) release([attachment]) // kilocode_change - release locally owned attachment URLs on removal
      setStore()("prompt", (parts) => parts.filter((part) => part.type !== "image" || part.id !== id))
    },
  }
}

export type PromptInputV2Store = ReturnType<typeof createPromptInputV2Store>

function insertText(prompt: PromptInputV2Prompt, cursor: number, content: string): PromptInputV2Prompt {
  let position = 0
  let inserted = false
  const parts = prompt.flatMap<PromptInputV2Prompt[number]>((part) => {
    if (part.type === "image") return [part]
    const start = position
    position += part.content.length
    if (inserted) return [part]
    if (part.type === "text" && cursor >= start && cursor <= position) {
      inserted = true
      const offset = cursor - start
      return [{ ...part, content: part.content.slice(0, offset) + content + part.content.slice(offset) }]
    }
    if (cursor > start) return [part]
    inserted = true
    return [{ type: "text", content, start: 0, end: 0 }, part]
  })
  if (!inserted) parts.push({ type: "text", content, start: 0, end: 0 })
  return withOffsets(parts)
}

function insertMention(
  prompt: PromptInputV2Prompt,
  start: number,
  end: number,
  mention: PromptInputV2FilePart | PromptInputV2AgentPart,
): PromptInputV2Prompt {
  let position = 0
  const parts = prompt.flatMap<PromptInputV2Prompt[number]>((part) => {
    if (part.type === "image") return [part]
    const partStart = position
    position += part.content.length
    if (part.type !== "text" || start < partStart || end > position) return [part]
    const before = part.content.slice(0, start - partStart)
    const after = part.content.slice(end - partStart)
    return [
      ...(before ? [{ type: "text" as const, content: before, start: 0, end: 0 }] : []),
      mention,
      { type: "text" as const, content: ` ${after}`, start: 0, end: 0 },
    ]
  })
  return withOffsets(parts)
}

function withOffsets(prompt: PromptInputV2Prompt): PromptInputV2Prompt {
  let offset = 0
  return prompt.map((part) => {
    if (part.type === "image") return part
    const next = { ...part, start: offset, end: offset + part.content.length }
    offset = next.end
    return next
  })
}

// kilocode_change start - replace text while keeping structured parts at their original boundaries
function replaceText(prompt: PromptInputV2Prompt, content: string): PromptInputV2Prompt {
  const current = prompt
    .filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("")
  if (current === content) return prompt
  if (!prompt.some((part) => part.type === "text")) {
    return withOffsets([{ type: "text", content, start: 0, end: 0 }, ...prompt])
  }

  let start = 0
  while (start < current.length && start < content.length && current[start] === content[start]) start++

  let end = current.length
  let next = content.length
  while (end > start && next > start && current[end - 1] === content[next - 1]) {
    end--
    next--
  }

  const value = content.slice(start, next)
  let offset = 0
  let inserted = false
  const parts = prompt.flatMap<PromptInputV2Prompt[number]>((part) => {
    if (part.type !== "text") return [part]
    const from = offset
    const to = from + part.content.length
    offset = to
    if (to < start || from > end) return [part]
    if (inserted) {
      if (end <= from) return [part]
      if (end < to) return [{ ...part, content: part.content.slice(end - from) }]
      return []
    }
    inserted = true
    const before = part.content.slice(0, Math.max(0, start - from))
    if (end <= to) return [{ ...part, content: before + value + part.content.slice(Math.max(0, end - from)) }]
    return [{ ...part, content: before + value }]
  })
  if (!inserted) parts.push({ type: "text", content: value, start: 0, end: 0 })
  return withOffsets(parts)
}

function release(prompt: PromptInputV2Prompt, next: PromptInputV2Prompt = []) {
  const keep = new Set(next.filter((part) => part.type === "image").map((part) => part.blob.url))
  prompt.forEach((part) => {
    if (part.type === "image" && part.blob.revoke && !keep.has(part.blob.url)) URL.revokeObjectURL(part.blob.url)
  })
}
// kilocode_change end

function promptLength(prompt: PromptInputV2Prompt) {
  return prompt.reduce((length, part) => length + ("content" in part ? part.content.length : 0), 0)
}
