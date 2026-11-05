/** The last path segment, for a compact review comment label. */
export function fileName(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "")
  return normalized.split("/").pop() ?? normalized
}
