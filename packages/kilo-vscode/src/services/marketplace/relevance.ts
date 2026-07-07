import * as vscode from "vscode"
import type { MarketplaceItem, MarketplaceRelevanceMetadata } from "./types"

const EXCLUDE = "**/{node_modules,.git,dist,build,out,.kilo,.opencode,.kilocode}/**"
// Build a regex from EXCLUDE so the same list drives both the glob pattern passed
// to findFiles and the in-memory post-filter (see context().find below).
// We extract the brace-group, escape dots only within each segment, and anchor on
// path separators so "builds.ts" or "distribution/" are never falsely excluded.
const EXCLUDE_REGEX = new RegExp(
  "(^|/)(" +
    EXCLUDE.replace(/^\*\*\/\{/, "")
      .replace(/\}\/\*\*$/, "")
      .split(",")
      .map((s) => s.replaceAll(".", "\\."))
      .join("|") +
    ")(/|$)",
)

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

interface RelevanceHost {
  extensions: readonly string[]
  find: (root: vscode.Uri, pattern: string) => Promise<boolean>
}

function context(): RelevanceHost {
  return {
    extensions: vscode.extensions.all.map((extension) => extension.id),
    find: async (root, pattern) => {
      const glob = new vscode.RelativePattern(root, `**/${pattern}`)
      const matches = await vscode.workspace.findFiles(glob, undefined, 5)
      const filtered = matches.filter((uri) => !EXCLUDE_REGEX.test(uri.fsPath.replaceAll("\\", "/")))
      return filtered.length > 0
    },
  }
}

export async function detectMarketplaceRelevance(
  items: MarketplaceItem[],
  roots: readonly vscode.Uri[],
  source: RelevanceHost = context(),
): Promise<MarketplaceRelevanceMetadata> {
  const patterns = Array.from(new Set(items.flatMap((item) => strings(item.suggest_for?.filename))))
  const files = new Map<string, boolean>()

  const batches = Array.from({ length: Math.ceil(patterns.length / 4) }, (_, index) =>
    patterns.slice(index * 4, index * 4 + 4),
  )
  for (const batch of batches) {
    await Promise.all(
      batch.map(async (pattern) => {
        const found = await Promise.all(
          roots.map((root) =>
            source.find(root, pattern).catch((err: unknown) => {
              console.warn(`[Kilo New] Marketplace relevance scan failed for ${pattern}:`, err)
              return false
            }),
          ),
        )
        files.set(pattern, found.some(Boolean))
      }),
    )
  }

  const extensions = new Set(source.extensions.map((id) => id.toLowerCase()))
  return Object.fromEntries(
    items.flatMap((item) => {
      const filename = strings(item.suggest_for?.filename).filter((pattern) => files.get(pattern))
      const vscodeExtension = strings(item.suggest_for?.vscode_extension).filter((id) =>
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
