import * as path from "node:path"
import * as vscode from "vscode"
import {
  listSessions,
  readTaskIndex,
  scanTaskStore,
  type ScanDiagnostic,
  type SessionCatalog,
  type SessionEntry,
} from "../legacy-migration/task-store"

const ROOTS = [
  "roovscode.roo-cline",
  "roovscode.roo-code",
  "rooveterinaryinc.roo-cline",
  "rooveterinaryinc.roo-code",
  "rooveterinaryinc.roo-code-nightly",
]

export interface RooImportSource {
  catalog: SessionCatalog
  sessions: ReturnType<typeof listSessions>
  diagnostics: ScanDiagnostic[]
}

/** Scans every known Roo storage root and keeps the most recent, complete copy of duplicate task IDs. */
export async function detectRooCodeSessions(
  context: vscode.ExtensionContext,
  customPath?: string,
): Promise<RooImportSource | null> {
  const parent = path.dirname(context.globalStorageUri.fsPath)
  const configured = customPath ?? vscode.workspace.getConfiguration("roo-cline").get<unknown>("customStoragePath", "")
  const custom = typeof configured === "string" ? configured.trim() : ""
  const roots = [
    ...ROOTS.map((root) => path.join(parent, root, "tasks")),
    ...(custom ? [path.join(custom, "tasks")] : []),
  ]
  const dirs = [...new Map(roots.map((dir) => [path.resolve(dir), dir])).values()]
  const catalog: SessionCatalog = new Map()
  const diagnostics: ScanDiagnostic[] = []

  for (const dir of dirs) {
    const items = await readTaskIndex(dir)
    const scan = await scanTaskStore(dir, items, { namespace: "roo", mode: "discover" })
    diagnostics.push(...scan.diagnostics)
    for (const [id, entry] of [...scan.catalog].sort(([a], [b]) => a.localeCompare(b))) {
      const current = catalog.get(id)
      if (!current || compare(entry, current) >= 0) catalog.set(id, entry)
    }
  }

  for (const diagnostic of diagnostics) {
    console.warn(`[Kilo New] Roo import skipped ${diagnostic.reason} task ${diagnostic.id} in ${diagnostic.dir}`)
  }

  const sessions = listSessions(catalog)
  return sessions.length ? { catalog, sessions, diagnostics } : null
}

function compare(a: SessionEntry, b: SessionEntry) {
  const complete = (entry: SessionEntry) =>
    Number(Boolean(entry.source.item?.task?.trim())) + Number(Boolean(entry.source.item?.mode))
  return (a.source.mtime ?? 0) - (b.source.mtime ?? 0) || a.session.time - b.session.time || complete(a) - complete(b)
}
