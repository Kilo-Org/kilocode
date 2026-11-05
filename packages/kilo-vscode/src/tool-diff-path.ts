// Pure path helpers for tool file links. They do not import `vscode`, so tests can cover the host paths
// without a running editor.
import path from "node:path"

/** The absolute path a tool file reference points at. An absolute `filePath` wins over `directory`. */
export function resolveToolFilePath(directory: string, filePath: string) {
  return path.resolve(directory, filePath)
}

/** Zero-based position for a 1-based line and column. Undefined without a positive line. */
export function filePosition(line?: number, column?: number) {
  if (line === undefined || line <= 0) return undefined
  return { line: line - 1, column: Math.max((column ?? 1) - 1, 0) }
}
