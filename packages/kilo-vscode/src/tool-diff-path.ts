// Pure path helpers for tool file links. They do not import `vscode`, so tests can cover the host paths
// without a running editor.
import path from "node:path"

/** The absolute path a tool file reference points at. An absolute `filePath` wins over `directory`. */
export function resolveToolFilePath(directory: string, filePath: string) {
  return path.resolve(directory, filePath)
}
