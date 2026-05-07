import { isAbsolutePath } from "../path-utils"

export function normalizeDiffStyle(style: unknown): "split" | "unified" {
  if (style === "split") return "split"
  return "unified"
}

export function resolveOpenFileInput(file: string): { type: "absolute" | "relative"; path: string } {
  if (isAbsolutePath(file)) return { type: "absolute", path: file }
  return { type: "relative", path: file }
}
