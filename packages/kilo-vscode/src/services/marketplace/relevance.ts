import * as vscode from "vscode"
import { minimatch } from "minimatch"
import type { MarketplaceItem, MarketplaceRelevanceMetadata } from "./types"

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

// vscode_extension entries are either bare ids or { name, id } objects.
function extensionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === "string") return item
      if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string")
        return (item as { id: string }).id
      return undefined
    })
    .filter((id): id is string => typeof id === "string")
}

/** Unique `suggest_for.filename` patterns of the given marketplace items. */
export function filenamePatterns(items: MarketplaceItem[]): string[] {
  return Array.from(new Set(items.flatMap((item) => strings(item.suggest_for?.filename))))
}

/** Whether a workspace-relative path matches a `suggest_for.filename` pattern. */
export function matchesPattern(file: string, pattern: string): boolean {
  return minimatch(file.replaceAll("\\", "/"), `**/${pattern}`, { dot: true })
}

/**
 * Combines the filename patterns the backend found in the workspace (it honors
 * .gitignore) with the installed VS Code extensions.
 */
export function detectMarketplaceRelevance(
  items: MarketplaceItem[],
  filenames: readonly string[],
  installed: readonly string[] = vscode.extensions.all.map((extension) => extension.id),
): MarketplaceRelevanceMetadata {
  const found = new Set(filenames)
  const extensions = new Set(installed.map((id) => id.toLowerCase()))
  return Object.fromEntries(
    items.flatMap((item) => {
      const filename = strings(item.suggest_for?.filename).filter((pattern) => found.has(pattern))
      const vscodeExtension = extensionIds(item.suggest_for?.vscode_extension).filter((id) =>
        extensions.has(id.toLowerCase()),
      )
      if (!filename?.length && !vscodeExtension?.length) return []
      return [
        [
          `${item.type}:${item.id}`,
          {
            ...(filename?.length && { filename }),
            ...(vscodeExtension?.length && { vscodeExtension }),
          },
        ],
      ]
    }),
  )
}
