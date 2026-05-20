/**
 * memory.ts — File-based persistent memory with typed taxonomy
 * Deps: Node built-ins (os, path, fs/promises)
 * Ported from Claude Code memdir/
 */

import { homedir } from "os"
import { join, normalize, sep, basename } from "path"
import { mkdir, readFile, writeFile, readdir, stat } from "fs/promises"

// ── Types ──────────────────────────────────────────

export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

export function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== "string") return undefined
  return MEMORY_TYPES.find(t => t === raw)
}

export interface MemoryHeader {
  filename: string
  filePath: string
  mtimeMs: number
  description: string | null
  type: MemoryType | undefined
}

// ── Age ────────────────────────────────────────────

export function memoryAgeDays(mtimeMs: number): number {
  return Math.max(0, Math.floor((Date.now() - mtimeMs) / 86_400_000))
}

export function memoryAge(mtimeMs: number): string {
  const d = memoryAgeDays(mtimeMs)
  if (d === 0) return "today"
  if (d === 1) return "yesterday"
  return `${d} days ago`
}

export function memoryFreshnessText(mtimeMs: number): string {
  const d = memoryAgeDays(mtimeMs)
  if (d <= 1) return ""
  return `This memory is ${d} days old. Memories are point-in-time observations, not live state — verify against current code before asserting as fact.`
}

// ── Paths ──────────────────────────────────────────

export const MAX_ENTRYPOINT_LINES = 200
export const MAX_ENTRYPOINT_BYTES = 25_000

export function getMemoryBaseDir(): string {
  return process.env.KILO_MEMORY_DIR ?? join(homedir(), ".config", "kilo")
}

export function getMemoryDir(projectRoot: string): string {
  if (process.env.KILO_MEMORY_DIR) return process.env.KILO_MEMORY_DIR
  return join(getMemoryBaseDir(), "projects", sanitize(projectRoot), "memory") + sep
}

export function getMemoryEntrypoint(projectRoot: string): string {
  return join(getMemoryDir(projectRoot), "MEMORY.md")
}

export function isMemoryPath(absolutePath: string, projectRoot: string): boolean {
  return normalize(absolutePath).startsWith(getMemoryDir(projectRoot))
}

function sanitize(p: string): string {
  return p.replace(/[<>:"|?*]/g, "_").replace(/[/\\]+/g, "_")
}

// ── Scan ───────────────────────────────────────────

const MAX_MEMORY_FILES = 200
const FM_MAX_LINES = 30

export async function scanMemoryFiles(dir: string): Promise<MemoryHeader[]> {
  try {
    const entries = await readdir(dir, { recursive: true })
    const mds = entries.filter(
      (f): f is string => typeof f === "string" && f.endsWith(".md") && basename(f) !== "MEMORY.md",
    )
    if (mds.length === 0) return []
    const results = await Promise.allSettled(mds.map(async (rel): Promise<MemoryHeader> => {
      const fp = join(dir, rel)
      const s = await stat(fp)
      const { description, type } = await parseFrontmatter(fp)
      return { filename: rel, filePath: fp, mtimeMs: s.mtimeMs, description, type }
    }))
    return results
      .filter((r): r is PromiseFulfilledResult<MemoryHeader> => r.status === "fulfilled")
      .map(r => r.value)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_MEMORY_FILES)
  } catch { return [] }
}

export function formatMemoryManifest(memories: MemoryHeader[]): string {
  return memories.map(m => {
    const tag = m.type ? `[${m.type}] ` : ""
    const ts = new Date(m.mtimeMs).toISOString()
    return m.description ? `- ${tag}${m.filename} (${ts}): ${m.description}` : `- ${tag}${m.filename} (${ts})`
  }).join("\n")
}

async function parseFrontmatter(
  filePath: string,
): Promise<{ description: string | null; type: MemoryType | undefined }> {
  try {
    const raw = await readFile(filePath, "utf-8")
    const lines = raw.split("\n").slice(0, FM_MAX_LINES)
    const acc = lines.reduce(
      (s, line) => {
        if (s.done) return s
        if (line.trim() === "---") { if (s.inFm) return { ...s, done: true }; return { ...s, inFm: true } }
        if (!s.inFm) return s
        const desc = line.match(/^description:\s*(.+)$/i)?.[1]
        const typ = line.match(/^type:\s*(.+)$/i)?.[1]
        return { ...s, desc: desc ?? s.desc, typeRaw: typ ?? s.typeRaw }
      },
      { inFm: false, done: false, desc: null as string | null, typeRaw: undefined as string | undefined },
    )
    return { description: acc.desc, type: parseMemoryType(acc.typeRaw) }
  } catch { return { description: null, type: undefined } }
}

// ── Entrypoint I/O ─────────────────────────────────

export function truncateEntrypoint(raw: string): { content: string; wasTruncated: boolean } {
  const trimmed = raw.trim()
  const lines = trimmed.split("\n")
  const wasLine = lines.length > MAX_ENTRYPOINT_LINES
  const wasByte = trimmed.length > MAX_ENTRYPOINT_BYTES
  if (!wasLine && !wasByte) return { content: trimmed, wasTruncated: false }
  const afterLine = wasLine ? lines.slice(0, MAX_ENTRYPOINT_LINES).join("\n") : trimmed
  const final = afterLine.length > MAX_ENTRYPOINT_BYTES
    ? (() => { const cut = afterLine.lastIndexOf("\n", MAX_ENTRYPOINT_BYTES); return afterLine.slice(0, cut > 0 ? cut : MAX_ENTRYPOINT_BYTES) })()
    : afterLine
  return { content: final + "\n\n> WARNING: MEMORY.md was truncated. Keep entries concise.", wasTruncated: true }
}

export async function readEntrypoint(projectRoot: string): Promise<string> {
  try { return await readFile(getMemoryEntrypoint(projectRoot), "utf-8") }
  catch { return "" }
}

export async function writeEntrypoint(projectRoot: string, content: string): Promise<void> {
  const { content: final } = truncateEntrypoint(content)
  await writeFile(getMemoryEntrypoint(projectRoot), final, "utf-8")
}

export async function ensureDir(projectRoot: string): Promise<string> {
  const dir = getMemoryDir(projectRoot)
  try { await mkdir(dir, { recursive: true }) } catch { /* exists */ }
  return dir
}

// ── Prompt builder ─────────────────────────────────

const TYPES_SECTION = [
  "## Types of memory", "",
  "There are several discrete types of memory you can store:", "",
  "<types>",
  '<type><name>user</name><description>User preferences, role, and knowledge.</description><when_to_save>When you learn about the user\'s role, preferences, or knowledge.</when_to_save></type>',
  '<type><name>feedback</name><description>Guidance about how to approach work — both corrections and confirmed approaches.</description><when_to_save>When the user corrects or confirms your approach.</when_to_save></type>',
  '<type><name>project</name><description>Ongoing work, goals, bugs, or incidents not derivable from code.</description><when_to_save>When you learn who is doing what, why, or by when.</when_to_save></type>',
  '<type><name>reference</name><description>Pointers to external systems and resources.</description><when_to_save>When you learn about external resources and their purpose.</when_to_save></type>',
  "</types>", "",
]

export async function buildPrompt(projectRoot: string): Promise<string> {
  const dir = getMemoryDir(projectRoot)
  const ep = await readEntrypoint(projectRoot)
  const lines = [
    "# auto memory", "",
    `You have a persistent memory system at \`${dir}\`. Write to it directly.`,
    "", "Build up this memory so future conversations have context about the user, their preferences, and project decisions.",
    "", ...TYPES_SECTION,
    "## What NOT to save in memory", "",
    "- Code patterns, architecture, file paths — derivable from current project state.",
    "- Git history — `git log` / `git blame` are authoritative.",
    "- Debugging solutions — the fix is in the code.",
    "- Ephemeral task details: in-progress work, temporary state.", "",
    "## When to access memories",
    "- When memories seem relevant to the user's request.",
    "- When the user explicitly asks you to recall something.",
    "- Memory records can become stale. Verify against current state before asserting as fact.", "",
  ]
  const epContent = ep.trim() ? truncateEntrypoint(ep).content : "Your MEMORY.md is currently empty."
  lines.push("## MEMORY.md", "", epContent)
  return lines.join("\n")
}

export async function scan(projectRoot: string) {
  return scanMemoryFiles(getMemoryDir(projectRoot))
}
