/**
 * Reconstruct `before` / `after` from a unified diff patch.
 *
 * Patches come from the backend via `git diff --unified=INT_MAX --no-renames`
 * (see packages/opencode/src/kilocode/snapshot/diff-full.ts). Because the
 * context is unbounded, every hunk contains all lines of the file with
 * ` `, `+`, or `-` prefixes, so reconstruction is a filter:
 *   - ` X` → both sides get X
 *   - `+X` → only `after` gets X
 *   - `-X` → only `before` gets X
 *
 * Empty patch (binary files, summarized patches over 256 KB) returns empty
 * strings on both sides.
 */
export function patchToBeforeAfter(patch: string): { before: string; after: string } {
  if (!patch) return { before: "", after: "" }

  const before: string[] = []
  const after: string[] = []
  let inHunk = false

  for (const line of patch.split("\n")) {
    if (line === "") continue

    if (!inHunk) {
      if (line.startsWith("@@")) inHunk = true
      continue
    }

    // Extra hunk header — defensive; INT_MAX context should emit only one.
    if (line.startsWith("@@")) continue
    // "\ No newline at end of file" marker — informational, no content.
    if (line.startsWith("\\")) continue
    // New file section inside a single-file patch shouldn't happen, but be
    // safe and re-enter header-scanning mode.
    if (line.startsWith("diff --git")) {
      inHunk = false
      continue
    }

    const prefix = line[0]
    const content = line.slice(1)
    if (prefix === " ") {
      before.push(content)
      after.push(content)
    } else if (prefix === "+") {
      after.push(content)
    } else if (prefix === "-") {
      before.push(content)
    }
  }

  return { before: before.join("\n"), after: after.join("\n") }
}
