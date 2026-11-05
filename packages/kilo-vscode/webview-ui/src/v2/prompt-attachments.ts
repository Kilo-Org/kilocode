import type { SessionPromptInput } from "@opencode/client/effect/api"
import type { PromptAttachment } from "../../../src/protocol"
import { fileName } from "../components/chat/prompt-input-utils"
import { convertToMentionPath } from "../utils/path-mentions"

type PromptFile = NonNullable<SessionPromptInput["files"]>[number]

export type DraftAttachmentInput = {
  id: string
  filename: string
  mime: string
  dataUrl: string
}

/** The dedupe key of an attachment: its kind, uri, name and source file when one is known. */
const attachmentKey = (item: PromptAttachment) =>
  `${item.kind}\u0000${item.uri}\u0000${item.name}\u0000${item.path ?? item.source ?? ""}`

/** Add the incoming attachments that are not already present, keeping their order. */
export function mergeAttachments(
  current: readonly PromptAttachment[],
  incoming: readonly PromptAttachment[],
): PromptAttachment[] {
  const seen = new Set(current.map(attachmentKey))
  const merged = [...current]
  for (const item of incoming) {
    const key = attachmentKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged
}

export function imageAttachment(img: DraftAttachmentInput): PromptAttachment {
  return { id: img.id, kind: "image", uri: img.dataUrl, name: img.filename }
}

/**
 * Turn dropped or pasted file paths into file attachments. The attachment keeps
 * an absolute `file:` URI for the model and the workspace-relative path for the
 * chip, so opening an outside-workspace file still uses its real location.
 */
export function fileAttachments(paths: string[], cwd: string): PromptAttachment[] {
  return paths
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .map((path) => {
      const absolute = absolutePath(path, cwd)
      const uri = fileUri(absolute)
      const relative = convertToMentionPath(path, cwd)
      return {
        id: uri,
        kind: "file" as const,
        uri,
        name: fileName(path),
        description: relative,
        path: relative,
      }
    })
}

export function toPromptFiles(items: readonly PromptAttachment[]): PromptFile[] {
  return items.map((item) => ({
    uri: item.uri,
    name: item.name,
    ...(item.description ? { description: item.description } : {}),
    ...(item.source ? { source: { type: "uri" as const, uri: item.source } } : {}),
  }))
}

/** The decoded UTF-8 text of a text `data:` URL, for chip previews. */
export function attachmentText(item: PromptAttachment): string | undefined {
  if (!item.uri.startsWith("data:")) return
  const comma = item.uri.indexOf(",")
  if (comma === -1) return
  const meta = item.uri.slice("data:".length, comma)
  const params = meta.split(";")
  const mime = params[0] ?? ""
  if (!mime.startsWith("text/")) return
  const payload = item.uri.slice(comma + 1)
  try {
    if (params.includes("base64")) return new TextDecoder().decode(base64Bytes(payload))
    return decodeURIComponent(payload)
  } catch {
    return
  }
}

function base64Bytes(payload: string): Uint8Array {
  return Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))
}

function absolutePath(path: string, cwd: string): string {
  const decoded = decodePath(pathWithoutScheme(path)).replaceAll("\\", "/")
  const joined = /^(?:[A-Za-z]:|\/)/.test(decoded) ? decoded : joinPath(cwd, decoded)
  if (/^[A-Za-z]:\//.test(joined)) return `/${joined}`
  return joined.startsWith("/") ? joined : `/${joined}`
}

function pathWithoutScheme(path: string): string {
  if (path.startsWith("file://")) return path.slice("file://".length)
  if (!path.startsWith("vscode-remote://")) return path
  const rest = path.slice("vscode-remote://".length)
  const slash = rest.indexOf("/")
  return slash === -1 ? "" : rest.slice(slash)
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function joinPath(cwd: string, path: string): string {
  const root = cwd.replaceAll("\\", "/").replace(/\/+$/, "")
  if (!root) return path
  return `${root}/${path}`
}

function fileUri(absolute: string): string {
  const encoded = absolute
    .split("/")
    .map((segment, index) => (/^[A-Za-z]:$/.test(segment) && index === 1 ? segment : encodeURIComponent(segment)))
    .join("/")
  return `file://${encoded}`
}

const attachments = new Map<string, PromptAttachment[]>()
const pastes = new Map<string, string[]>()

export const attachmentDrafts = {
  get(key: string | undefined): PromptAttachment[] {
    return key ? (attachments.get(key) ?? []) : []
  },
  set(key: string | undefined, items: readonly PromptAttachment[]) {
    if (!key) return
    if (items.length > 0) attachments.set(key, [...items])
    else attachments.delete(key)
  },
}

export const pasteDrafts = {
  get(key: string | undefined): string[] {
    return key ? (pastes.get(key) ?? []) : []
  },
  set(key: string | undefined, texts: readonly string[]) {
    if (!key) return
    if (texts.length > 0) pastes.set(key, [...texts])
    else pastes.delete(key)
  },
}
