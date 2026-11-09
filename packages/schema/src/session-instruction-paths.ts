// kilocode_change - new file
// kilocode_change(read-loaded-files) - shared decoder for the synthetic instruction metadata the TUI and VS Code clients render

/**
 * The files a synthetic instruction message reported as loaded. The server publishes
 * this shape on the synthetic event metadata; clients render the paths beside a read.
 */
export function readInstructionPaths(metadata: unknown): readonly string[] {
  if (!metadata || typeof metadata !== "object") return []
  const instruction = (metadata as { instruction?: unknown }).instruction
  if (!instruction || typeof instruction !== "object") return []
  const paths = (instruction as { paths?: unknown }).paths
  return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string") : []
}