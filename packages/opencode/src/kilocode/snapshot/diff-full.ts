// kilocode_change - new file
//
// Patch generation. Runs `git diff --unified=3` to produce
// unified-diff text for a set of files, instead of the npm `diff` package's
// JS Myers implementation. Myers is O(N*M), so on
// huge-file diffs it can block the event loop for minutes (the TUI freeze
// where ESC stopped working after a turn).
//
// Both helpers fail soft: on any git error they return an empty value so
// callers emit an empty patch string. Additions/deletions come from
// `git --numstat` and stay accurate.

import { Effect } from "effect"
import { parsePatch } from "diff"
import type { StructuredPatch } from "diff"
import * as Log from "@opencode-ai/core/util/log"

export namespace DiffFull {
  const log = Log.create({ service: "snapshot.diff-full" })

  // Keep context bounded. Git's effectively infinite context can emit
  // malformed repeated hunks on Windows and makes persisted snapshots huge.
  const unified = "--unified=3"

  interface GitResult {
    readonly code: number
    readonly text: string
    readonly stderr: string
  }

  /**
   * Run `git diff --unified=3` for a set of files between two refs and
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

  // Cap the full-content sides we return for a single editor diff tab. Anything larger falls back
  // to the hunk-only view rather than shipping tens of MB of text over RPC.
  export const MAX_DETAIL_SIZE = 20 * 1024 * 1024

  /**
   * Authoritative full-content detail for one file between two snapshot refs, for the editor diff
   * tab. Returns status, additions/deletions, the hunk patch, and the whole before/after file
   * contents (read from the snapshot objects via `git show`), so the client can render a whole-file
   * diff regardless of the current working tree. `before`/`after` are omitted when a side exceeds
   * [MAX_DETAIL_SIZE]; binary files carry no content. `run.diff` wraps quote+args, `run.show` wraps
   * the plain config (no quotepath) so `git show ref:path` resolves correctly.
   */
  export const detail = Effect.fn("DiffFull.detail")(function* (
    run: {
      diff: (cmd: string[]) => Effect.Effect<GitResult>
      show: (cmd: string[]) => Effect.Effect<GitResult>
    },
    from: string,
    to: string,
    path: string,
  ) {
    const names = yield* run.diff(["diff", "--no-ext-diff", "--name-status", "--no-renames", from, to, "--", path])
    const row = names.text.trim().split("\n").find(Boolean)
    if (!row) return undefined
    const code = row.split("\t")[0] ?? ""
    const status: "added" | "deleted" | "modified" =
      code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified"

    const numstat = yield* run.diff(["diff", "--no-ext-diff", "--no-renames", "--numstat", from, to, "--", path])
    const [adds, dels] = numstat.text.trim().split("\n").find(Boolean)?.split("\t") ?? []
    const binary = adds === "-" && dels === "-"
    const additions = binary ? 0 : Number.parseInt(adds ?? "0", 10)
    const deletions = binary ? 0 : Number.parseInt(dels ?? "0", 10)

    const patch = binary ? "" : ((yield* batch(run.diff, from, to, [path])).get(path) ?? "")
    const base = {
      file: path,
      patch,
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
      status,
    }
    // Uniform shape across branches: binary files carry no content, but keep the keys present
    // (undefined) so the return type is a single object, not a union missing before/after.
    if (binary) return { ...base, before: undefined, after: undefined }

    const content = yield* Effect.all(
      {
        before: status === "added" ? Effect.succeed("") : run.show(["show", `${from}:${path}`]).pipe(Effect.map((r) => r.text)),
        after: status === "deleted" ? Effect.succeed("") : run.show(["show", `${to}:${path}`]).pipe(Effect.map((r) => r.text)),
      },
      { concurrency: 2 },
    )
    return {
      ...base,
      before: Buffer.byteLength(content.before) <= MAX_DETAIL_SIZE ? content.before : undefined,
      after: Buffer.byteLength(content.after) <= MAX_DETAIL_SIZE ? content.after : undefined,
    }
  })

  /**
   * Generate a structured + unified diff for a single file in the working
   * tree vs HEAD using `git diff --ignore-all-space --unified=3`.
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
