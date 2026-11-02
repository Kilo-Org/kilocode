// Pure path helpers for the tool diff surface. They do not import `vscode`, so tests can cover the host paths
// without a running editor.
import path from "node:path"

/** The absolute path a tool file reference points at. An absolute `filePath` wins over `directory`. */
export function resolveToolFilePath(directory: string, filePath: string) {
  return path.resolve(directory, filePath)
}

/** The virtual document path for one side of a diff. `id` keeps every open diff unique; `file` is display-only. */
export function virtualDiffPath(id: string, side: "before" | "after", file: string) {
  return `/${id}/${side}/${file.replace(/^\/+/, "")}`
}
