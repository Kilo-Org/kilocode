import * as path from "node:path"
import * as vscode from "vscode"
import type { MigrationSessionInfo } from "./legacy-types"
import type { LegacyHistoryItem } from "./sessions/lib/legacy-types"

const API_FILE = "api_conversation_history.json"
const UI_FILE = "ui_messages.json"

export interface SessionSource {
  id: string
  dir: string
  item?: LegacyHistoryItem
  namespace?: string
  mtime?: number
}

export interface SessionEntry {
  id: string
  session: MigrationSessionInfo
  source: SessionSource
}

export type SessionCatalog = Map<string, SessionEntry>

export interface ScanDiagnostic {
  id: string
  dir: string
  reason: "ui-only" | "malformed" | "missing-workspace"
}

export interface TaskScan {
  catalog: SessionCatalog
  diagnostics: ScanDiagnostic[]
}

export function listSessions(catalog: SessionCatalog) {
  return [...catalog.values()].map((entry) => entry.session).sort((a, b) => b.time - a.time || a.id.localeCompare(b.id))
}

export function resolveSession(catalog: SessionCatalog, id: string) {
  return catalog.get(id)?.source
}

export type ScanMode = "history" | "discover"

export interface ScanOptions {
  namespace?: string
  /**
   * "history" trusts the provided history items and only checks that each task's
   * conversation file still exists (cheap stat, used by legacy migration).
   * "discover" enumerates every task directory on disk and parses conversation
   * files to recover titles (used when no history is available, e.g. Roo import).
   */
  mode?: ScanMode
}

export async function scanTaskStore(
  dir: string,
  items: LegacyHistoryItem[] = [],
  options: ScanOptions = {},
): Promise<TaskScan> {
  const mode = options.mode ?? (items.length ? "history" : "discover")
  return mode === "history"
    ? scanFromHistory(dir, items, options.namespace)
    : scanFromDisk(dir, items, options.namespace)
}

/** Builds a catalog from known history items, only confirming each conversation file exists. */
async function scanFromHistory(dir: string, items: LegacyHistoryItem[], namespace?: string): Promise<TaskScan> {
  const catalog: SessionCatalog = new Map()

  for (const item of items) {
    if (catalog.has(item.id)) continue
    if (!(await exists(path.join(dir, item.id, API_FILE)))) continue
    catalog.set(item.id, {
      id: item.id,
      session: {
        id: item.id,
        title: item.task?.trim() || fallbackTitle(item.id),
        directory: item.workspace?.trim() || "",
        time: item.ts ?? timestamp(item.id),
      },
      source: { id: item.id, dir, item, namespace },
    })
  }

  return { catalog, diagnostics: [] }
}

/** Enumerates every task directory on disk and parses conversation files to recover titles. */
async function scanFromDisk(dir: string, items: LegacyHistoryItem[], namespace?: string): Promise<TaskScan> {
  const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir)).then(
    (value) => value,
    () => [] as [string, vscode.FileType][],
  )
  const history = new Map(items.map((item) => [item.id, item]))
  const catalog: SessionCatalog = new Map()
  const diagnostics: ScanDiagnostic[] = []

  for (const [id, type] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    if (type !== vscode.FileType.Directory) continue
    const root = path.join(dir, id)
    const api = path.join(root, API_FILE)
    const valid = await readHistory(api)
    if (!valid.exists) {
      if (await exists(path.join(root, UI_FILE))) diagnostics.push({ id, dir, reason: "ui-only" })
      continue
    }
    if (!valid.valid) {
      diagnostics.push({ id, dir, reason: "malformed" })
      continue
    }

    const item = await readHistoryItem(root, id, valid.data, history.get(id))
    const workspace = item.workspace?.trim()
    if (!workspace) {
      diagnostics.push({ id, dir, reason: "missing-workspace" })
      continue
    }
    catalog.set(id, {
      id,
      session: {
        id,
        title: item.task?.trim() || fallbackTitle(id),
        directory: workspace,
        time: item.ts ?? timestamp(id),
      },
      source: { id, dir, item, namespace, mtime: valid.mtime },
    })
  }

  return { catalog, diagnostics }
}

export async function readTaskIndex(dir: string): Promise<LegacyHistoryItem[]> {
  return Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.file(path.join(dir, "_index.json"))))
    .then((bytes) => {
      const json = JSON.parse(Buffer.from(bytes).toString("utf8")) as { entries?: unknown }
      if (!Array.isArray(json.entries)) return []
      return json.entries.flatMap((value) => {
        if (!value || typeof value !== "object") return []
        const item = value as Record<string, unknown>
        if (typeof item.id !== "string") return []
        return [parseRecord(item, item.id)]
      })
    })
    .catch(() => [])
}

async function readHistory(file: string) {
  const uri = vscode.Uri.file(file)
  return Promise.all([vscode.workspace.fs.readFile(uri), vscode.workspace.fs.stat(uri)])
    .then(([bytes, stat]) => {
      const json = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown
      return {
        exists: true as const,
        valid: Array.isArray(json),
        data: Array.isArray(json) ? json : [],
        mtime: stat.mtime,
      }
    })
    .catch((error) => {
      if (error instanceof SyntaxError) {
        return { exists: true as const, valid: false, data: [] as unknown[], mtime: 0 }
      }
      return { exists: false as const, valid: false, data: [] as unknown[], mtime: 0 }
    })
}

async function readHistoryItem(
  root: string,
  id: string,
  messages: unknown[],
  indexed?: LegacyHistoryItem,
): Promise<LegacyHistoryItem> {
  const file = path.join(root, "history_item.json")
  const stored = await Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.file(file)))
    .then((bytes) => parseItem(Buffer.from(bytes).toString("utf8"), id))
    .catch(() => undefined)
  if (stored) return stored
  if (indexed) return indexed

  return {
    id,
    task: titleFromMessages(messages) || fallbackTitle(id),
    workspace: "",
    ts: timestamp(id),
  }
}

function parseItem(input: string, id: string): LegacyHistoryItem | undefined {
  return parseRecord(JSON.parse(input) as Record<string, unknown>, id)
}

function parseRecord(json: Record<string, unknown>, id: string): LegacyHistoryItem {
  return {
    id,
    task: typeof json.task === "string" ? json.task.trim().slice(0, 120) : fallbackTitle(id),
    workspace: typeof json.workspace === "string" ? json.workspace : "",
    ts: typeof json.ts === "number" ? json.ts : timestamp(id),
    mode: typeof json.mode === "string" ? json.mode : undefined,
    rootTaskId: typeof json.rootTaskId === "string" ? json.rootTaskId : undefined,
    parentTaskId: typeof json.parentTaskId === "string" ? json.parentTaskId : undefined,
  }
}

function titleFromMessages(messages: unknown[]) {
  for (const value of messages) {
    if (!value || typeof value !== "object") continue
    const msg = value as { role?: string; content?: unknown }
    if (msg.role !== "user") continue
    const text = textFromContent(msg.content)
    if (text) return text.slice(0, 120).replace(/\n/g, " ").trim()
  }
  return ""
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  for (const value of content) {
    if (!value || typeof value !== "object") continue
    const block = value as { type?: string; text?: unknown }
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) return block.text
  }
  return ""
}

function exists(file: string) {
  return vscode.workspace.fs.stat(vscode.Uri.file(file)).then(
    () => true,
    () => false,
  )
}

function timestamp(id: string) {
  const value = Number(id)
  return Number.isFinite(value) && value > 1_000_000_000_000 ? value : 0
}

function fallbackTitle(id: string) {
  const time = timestamp(id)
  return time ? new Date(time).toLocaleString() : id
}
