// kilocode_change - new file
import type { LSPClient } from "@/lsp/client"

/**
 * Filter diagnostics to only include entries for the specified files.
 * Tools like edit, write, and apply_patch receive diagnostics for ALL project files
 * from the LSP, but only the edited files' diagnostics are relevant for storage
 * and display. Storing all files' diagnostics bloats session payloads significantly
 * (100KB+ per tool call in large projects).
 */
export function filterDiagnostics(
  diagnostics: Record<string, LSPClient.Diagnostic[]>,
  files: string[],
): Record<string, LSPClient.Diagnostic[]> {
  const result: Record<string, LSPClient.Diagnostic[]> = {}
  for (const file of files) {
    const items = diagnostics[file]
    if (items) result[file] = items
  }
  return result
}
