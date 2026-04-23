// kilocode_change - new file
//
// Patch generation. Runs `git diff --unified=INT_MAX` to produce
// unified-diff text for a set of files, instead of the npm `diff` package's
// JS Myers implementation. Myers is O(N*M) with full context, so on
// huge-file diffs it can block the event loop for minutes (the TUI freeze
// where ESC stopped working after a turn).
//
// Both helpers fail soft: on any git error they return an empty value so
// callers emit an empty patch string. Additions/deletions come from
// `git --numstat` and stay accurate.

import { Effect } from "effect"
import { parsePatch } from "diff"
import type { StructuredPatch } from "diff"
import { Log } from "../../util"

export namespace DiffFull {
  const log = Log.create({ service: "snapshot.diff-full" })

  // INT_MAX — git clamps to this, effectively infinite context.
  const unified = "--unified=2147483647"

  interface GitResult {
    readonly code: number
    readonly text: string
    readonly stderr: string
  }

  /**
   * Run `git diff --unified=INT_MAX` for a set of files between two refs and
   * return a `file → unified-diff text` map. Output format matches what the
   * `diff` package's `parsePatch` expects, so downstream clients continue to
   * work.
   *
   * `files` entries must use forward slashes (git's output uses `/` even on
   * Windows); paths with backslashes will silently miss the suffix match.
   *
   * Returns an empty map if `files` is empty or git fails. Callers emit an
   * empty patch string for any file missing from the map; numstat-derived
   * additions/deletions stay accurate.
   */
  export const batch = Effect.fn("DiffFull.batch")(function* (
    git: (cmd: string[]) => Effect.Effect<GitResult>,
    from: string,
    to: string,
    files: string[],
  ) {
    const map = new Map<string, string>()
    if (files.length === 0) return map

    // Windows cmdline limit is ~8191 chars. 500 * avg-15-char filename ≈ 7500.
    const size = 500
    let failed = 0
    let stderr = ""
    for (let i = 0; i < files.length; i += size) {
      const chunk = files.slice(i, i + size)
      const result = yield* git([
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-renames",
        unified,
        from,
        to,
        "--",
        ...chunk,
      ])
      if (result.code !== 0) {
        failed += 1
        stderr = result.stderr || stderr
        continue
      }
      parseBatch(result.text, chunk, map)
    }
    if (failed) {
      log.info("git diff failed, emitting empty patches for affected files", {
        chunksFailed: failed,
        filesTotal: files.length,
        stderr,
      })
    }
    return map
  })

  /**
   * Generate a structured + unified diff for a single file in the working
   * tree vs HEAD using `git diff --ignore-all-space --unified=INT_MAX`.
   * Returns `null` if git produces no output (caller emits a content-only
   * response with no patch).
   */
  export const file = Effect.fn("DiffFull.file")(function* (
    gitText: (args: string[]) => Effect.Effect<string>,
    file: string,
  ) {
    const flags = ["-c", "core.fsmonitor=false", "diff", "--no-color", "--no-ext-diff", "--ignore-all-space", unified]
    const primary = yield* gitText([...flags, "--", file])
    const text = primary.trim() ? primary : yield* gitText([...flags, "--staged", "--", file])
    if (!text.trim()) return null
    const parsed = parsePatch(text)[0]
    if (!parsed) return null
    // Normalize paths to match what `structuredPatch(file, file, ...)` used to
    // produce — downstream UIs key off the bare filename, not `a/…` / `b/…`.
    const patch: StructuredPatch = {
      ...parsed,
      oldFileName: file,
      newFileName: file,
    }
    return { patch, text }
  })

  /**
   * Split a multi-file `git diff` output into one entry per file, keyed by
   * the input filename (not the path from the header — that can be quoted).
   * Silently drops sections whose header does not match any entry in `chunk`.
   */
  function parseBatch(text: string, chunk: string[], map: Map<string, string>) {
    // Longest-first so `lib/a.txt` beats `a.txt` on suffix matches.
    const ordered = chunk.slice().sort((a, b) => b.length - a.length)
    // With `--no-renames` the header is always `diff --git a/PATH b/PATH` with
    // both PATHs identical, so we can confirm both halves to avoid false
    // positives where PATH happens to also appear as a substring earlier in
    // the line (e.g. a filename containing ` b/`).
    const match = (header: string) => {
      for (const f of ordered) {
        if (header.endsWith(" b/" + f) && header.includes(" a/" + f + " ")) return f
        if (header.endsWith(` "b/${f}"`) && header.includes(` "a/${f}" `)) return f
      }
      return null
    }

    let current: string | null = null
    let buffer: string[] = []
    const flush = () => {
      if (current !== null && buffer.length) map.set(current, buffer.join("\n"))
      current = null
      buffer = []
    }

    for (const line of text.split("\n")) {
      if (line.startsWith("diff --git ")) {
        flush()
        current = match(line)
        if (current !== null) buffer.push(line)
        continue
      }
      if (current !== null) buffer.push(line)
    }
    flush()
  }
}
