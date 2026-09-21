/** Literal branch rules used by Git's check-ref-format, without checkout shorthand expansion. */
export function validBranch(name: string | undefined): boolean {
  if (name === undefined) return true
  if (!name || name === "HEAD" || name.startsWith("-") || name.endsWith(".")) return false
  if (/[\x00-\x20\x7f~^:?*\[\\]/.test(name) || name.includes("..") || name.includes("@{")) return false
  return name.split("/").every((part) => !!part && !part.startsWith(".") && !part.endsWith(".lock"))
}
