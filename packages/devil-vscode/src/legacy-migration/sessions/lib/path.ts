import * as fs from "fs/promises"
import * as path from "path"

export async function normalizeLegacyPath(input?: string): Promise<string> {
  const raw = input?.trim()
  if (!raw) return ""

  // Collapse legacy paths into one stable absolute form before importing them.
  const normalized = path.normalize(path.resolve(raw))
  const canonical = normalizeWindowsDriveLetter(normalized)

  return fs.realpath(canonical).catch(() => canonical)
}

export function isWindowsDrivePath(input: string): boolean {
  return /^[a-z]:[\\/]/i.test(input)
}

function normalizeWindowsDriveLetter(input: string): string {
  // Match the canonical drive-letter casing used later by Windows path filters.
  if (!isWindowsDrivePath(input)) return input
  const head = input[0]
  if (!head) return input
  return head.toUpperCase() + input.slice(1)
}
