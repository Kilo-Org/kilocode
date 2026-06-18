/**
 * roo-import/service.ts
 *
 * Detects and reads sessions from a Roo Code extension installation.
 * Uses the same data format as the legacy Kilo Code migration — Roo Code
 * stores tasks under `<globalStorage>/<extensionId>/tasks/<id>/api_conversation_history.json`,
 * identical to the format the existing migration pipeline already handles.
 *
 * Rich metadata (title, workspace, timestamp) is read from `history_item.json`
 * when available, falling back to parsing the first user message in the
 * conversation file.
 */

import * as path from "node:path"
import * as vscode from "vscode"
import type { MigrationSessionInfo } from "../legacy-migration/legacy-types"
import type { LegacyApiMessage, LegacyHistoryItem } from "../legacy-migration/sessions/lib/legacy-types"

/**
 * Known Roo Code VS Code extension IDs.
 * Includes stable, nightly, and alternate publisher variants.
 */
const ROO_CODE_EXTENSION_IDS = [
  "roovscode.roo-cline",
  "roovscode.roo-code",
  "rooveterinaryinc.roo-cline",
  "rooveterinaryinc.roo-code",
  "rooveterinaryinc.roo-code-nightly",
]

const API_HISTORY_FILE = "api_conversation_history.json"
const UI_MESSAGES_FILE = "ui_messages.json"

export interface RooImportSource {
  /** Absolute path to the Roo Code tasks directory. */
  dir: string
  sessions: MigrationSessionInfo[]
  items: LegacyHistoryItem[]
  formats: Record<string, "api" | "ui">
}

/**
 * Discovers the Roo Code tasks directory by looking for known Roo Code extension
 * IDs as siblings of the current extension's global storage directory.
 * Returns `null` when no Roo Code installation is detected.
 */
export async function detectRooCodeSessions(context: vscode.ExtensionContext): Promise<RooImportSource | null> {
  const storageParent = path.dirname(context.globalStorageUri.fsPath)

  for (const id of ROO_CODE_EXTENSION_IDS) {
    const dir = path.join(storageParent, id, "tasks")
    const result = await scanTasksDir(dir)
    if (result) return result
  }

  return null
}

async function scanTasksDir(dir: string): Promise<RooImportSource | null> {
  const uri = vscode.Uri.file(dir)
  let entries: [string, vscode.FileType][]
  try {
    entries = await vscode.workspace.fs.readDirectory(uri)
  } catch {
    return null
  }

  const sessions: MigrationSessionInfo[] = []
  const items: LegacyHistoryItem[] = []
  const formats: Record<string, "api" | "ui"> = {}

  for (const [name, type] of entries) {
    if (type !== vscode.FileType.Directory) continue
    const taskDir = path.join(dir, name)
    const hasApi = await exists(path.join(taskDir, API_HISTORY_FILE))
    const hasUi = hasApi ? false : await exists(path.join(taskDir, UI_MESSAGES_FILE))
    if (!hasApi && !hasUi) continue

    const meta = await readHistoryItem(taskDir, name)
    const fallback = hasApi || meta.title !== formatFallbackTitle(name) ? meta : await readUiMetadata(taskDir, name)

    sessions.push({
      id: name,
      title: fallback.title,
      directory: fallback.workspace,
      time: fallback.ts,
    })

    items.push({
      id: name,
      ts: fallback.ts,
      task: fallback.title,
      workspace: fallback.workspace,
      mode: fallback.mode,
    })

    formats[name] = hasApi ? "api" : "ui"
  }

  if (sessions.length === 0) return null

  // Sort newest first (matches legacy migration UI order)
  sessions.sort((a, b) => b.time - a.time)
  items.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))

  return { dir, sessions, items, formats }
}

async function exists(file: string) {
  return vscode.workspace.fs.stat(vscode.Uri.file(file)).then(
    () => true,
    () => false,
  )
}

interface TaskMeta {
  title: string
  workspace: string
  ts: number
  mode?: string
}

/**
 * Reads task metadata from `history_item.json` when available (Roo Code stores
 * the title, workspace, and timestamp there). Falls back to parsing the first
 * user message in `api_conversation_history.json` and the task ID as a timestamp.
 */
async function readHistoryItem(taskDir: string, id: string): Promise<TaskMeta> {
  const file = path.join(taskDir, "history_item.json")
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(file))
    const json = JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<string, unknown>
    const ts = typeof json.ts === "number" ? json.ts : parseTaskTimestamp(id)
    const title = typeof json.task === "string" && json.task.trim() ? json.task.trim().slice(0, 120) : undefined
    const workspace = typeof json.workspace === "string" ? json.workspace : ""
    const mode = typeof json.mode === "string" ? json.mode : undefined
    return {
      title: title ?? formatFallbackTitle(id),
      workspace,
      ts,
      mode,
    }
  } catch {
    // history_item.json not available — fall back to conversation file
  }

  const ts = parseTaskTimestamp(id)
  const title = await extractTitleFromHistory(path.join(taskDir, "api_conversation_history.json"), id)
  return { title, workspace: "", ts }
}

async function readUiMetadata(taskDir: string, id: string): Promise<TaskMeta> {
  const conversation = await readRooUiConversation(taskDir, id)
  const first = conversation.find((msg) => msg.role === "user")
  const title =
    typeof first?.content === "string" && first.content.trim() ? first.content.trim().slice(0, 120) : undefined
  return {
    title: title ?? formatFallbackTitle(id),
    workspace: "",
    ts: first?.ts ?? parseTaskTimestamp(id),
  }
}

interface RooUiMessage {
  ts?: number
  type?: string
  say?: string
  ask?: string
  text?: string
}

export async function readRooUiConversation(taskDir: string, id: string): Promise<LegacyApiMessage[]> {
  const file = path.join(taskDir, UI_MESSAGES_FILE)
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(file))
  const json = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown
  if (!Array.isArray(json)) return []

  return json.flatMap((entry, index) => toApiMessage(entry, index, id))
}

function toApiMessage(input: unknown, index: number, id: string): LegacyApiMessage[] {
  if (!input || typeof input !== "object") return []
  const msg = input as RooUiMessage
  const text = typeof msg.text === "string" ? msg.text.trim() : ""
  if (!text) return []

  const role = getRole(msg, index)
  if (!role) return []

  return [
    {
      role,
      content: text,
      ts: msg.ts ?? parseTaskTimestamp(id),
      ...(msg.say === "reasoning" ? { type: "reasoning" as const, text } : {}),
    },
  ]
}

function getRole(msg: RooUiMessage, index: number): "user" | "assistant" | undefined {
  if (msg.type === "ask" && (msg.ask === "text" || msg.ask === "followup")) return "user"
  if (msg.type !== "say") return undefined
  if (index === 0 && msg.say === "text") return "user"
  if (msg.say === "text" || msg.say === "reasoning") return "assistant"
  return undefined
}

/**
 * Roo Code task IDs are numeric millisecond timestamps (e.g. `1699023456789`).
 * Returns the parsed value or 0 for non-numeric IDs.
 */
function parseTaskTimestamp(id: string): number {
  const n = Number(id)
  return Number.isFinite(n) && n > 1_000_000_000_000 ? n : 0
}

/**
 * Reads the first user message from `api_conversation_history.json` to derive
 * a human-readable session title, falling back to the task ID.
 */
async function extractTitleFromHistory(file: string, fallback: string): Promise<string> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(file))
    const json = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown
    if (!Array.isArray(json)) return formatFallbackTitle(fallback)
    for (const msg of json) {
      if (!msg || typeof msg !== "object") continue
      if ((msg as { role?: string }).role !== "user") continue
      const content = (msg as { content?: unknown }).content
      const text = extractText(content)
      if (text) return text.slice(0, 120).replace(/\n/g, " ").trim()
    }
  } catch {
    // fall through to default
  }
  return formatFallbackTitle(fallback)
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
        const t = (block as { text?: unknown }).text
        if (typeof t === "string" && t.trim()) return t
      }
    }
  }
  return ""
}

/**
 * Formats a numeric timestamp ID as a readable date, or returns the raw ID
 * for non-numeric task IDs.
 */
function formatFallbackTitle(id: string): string {
  const ts = parseTaskTimestamp(id)
  return ts > 0 ? new Date(ts).toLocaleString() : id
}
