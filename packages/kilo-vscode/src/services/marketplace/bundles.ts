import * as path from "path"
import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"

export interface McpBundle {
  id: string
  scope: "project" | "global"
  skills: string[]
}

const OWNER_FILE = ".kilo-marketplace.json"
const MAX_MARKER_BYTES = 4096
const BUILTIN_LOCATIONS = new Set(["builtin", "<built-in>"])
const SAFE_ID = /^[A-Za-z0-9_@.-]+$/
const RESERVED_ID = /^(?:\.|\.\.|con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Marker {
  version: 1
  id: string
  token: string
}

function validMarker(value: unknown): value is Marker {
  if (!value || typeof value !== "object") return false
  const obj = value as Record<string, unknown>
  if (obj.version !== 1) return false
  if (typeof obj.id !== "string" || !SAFE_ID.test(obj.id) || RESERVED_ID.test(obj.id)) return false
  if (typeof obj.token !== "string" || !UUID.test(obj.token)) return false
  return true
}

async function readMarker(markerUri: vscode.Uri): Promise<Marker | undefined> {
  const stat = await vscode.workspace.fs.stat(markerUri).then(
    (s) => s,
    () => undefined,
  )
  if (!stat) return undefined
  if ((stat.type & vscode.FileType.SymbolicLink) !== 0) return undefined
  if ((stat.type & vscode.FileType.File) === 0) return undefined
  if (stat.size > MAX_MARKER_BYTES) return undefined
  const bytes = await vscode.workspace.fs.readFile(markerUri).then(
    (data) => data,
    () => undefined,
  )
  if (!bytes) return undefined
  const parsed = ((): unknown => {
    try {
      return JSON.parse(Buffer.from(bytes).toString("utf8"))
    } catch {
      return undefined
    }
  })()
  return validMarker(parsed) ? parsed : undefined
}

function scopeFor(skillPath: string, directory: string): "project" | "global" {
  const relative = path.relative(directory, skillPath)
  return relative.startsWith("..") || path.isAbsolute(relative) ? "global" : "project"
}

/**
 * Derive marketplace MCP+companion-skill bundles by reading the ownership
 * marker (`.kilo-marketplace.json`) next to each skill's `SKILL.md`. There is
 * no CLI endpoint for this — the CLI only writes the marker, so bundle
 * membership is reconstructed client-side the same way for every consumer
 * (the Skills settings subtab uses this to confirm bundle-aware removal).
 */
export async function marketplaceBundles(client: KiloClient, directory: string): Promise<McpBundle[]> {
  const { data: skills } = await client.app.skills({ directory }, { throwOnError: true })
  const owned = new Map<string, { scope: "project" | "global"; skills: Set<string> }>()

  for (const skill of skills) {
    if (BUILTIN_LOCATIONS.has(skill.location)) continue
    if (!path.isAbsolute(skill.location)) continue
    const dir = path.dirname(skill.location)
    const markerUri = vscode.Uri.file(path.join(dir, OWNER_FILE))
    const marker = await readMarker(markerUri)
    if (!marker) continue
    const scope = scopeFor(skill.location, directory)
    const key = `${scope}\u0000${marker.id}`
    const entry = owned.get(key) ?? { scope, skills: new Set<string>() }
    entry.skills.add(skill.location)
    owned.set(key, entry)
  }

  return [...owned.entries()]
    .map(([key, entry]) => ({
      id: key.slice(key.indexOf("\u0000") + 1),
      scope: entry.scope,
      skills: [...entry.skills].sort(),
    }))
    .sort((a, b) => (a.scope === b.scope ? a.id.localeCompare(b.id) : a.scope.localeCompare(b.scope)))
}
