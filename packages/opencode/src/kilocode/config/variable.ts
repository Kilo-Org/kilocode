import fs from "node:fs/promises"
import { realpathSync, statSync } from "node:fs"
import path from "node:path"
import { createScanner } from "jsonc-parser"

export namespace ConfigVariableGuard {
  export type FileScope = {
    root: string
    source: string
  }

  // A deliberate security block (out-of-scope, swapped, or /proc) — distinct from a plain missing/IO error so
  // callers using missing:"empty" still surface the block instead of silently emptying it.
  export class BlockedError extends Error {
    readonly blocked = true as const
  }

  export function isBlocked(err: unknown): err is BlockedError {
    return err instanceof BlockedError || (typeof err === "object" && err !== null && (err as any).blocked === true)
  }

  const secret = new Set([
    "KILO_SERVER_PASSWORD",
    "KILO_SERVER_USERNAME",
    "KILO_BROWSER_BROKER_URL",
    "KILO_BROWSER_BROKER_TOKEN",
  ])

  // jsonc-parser's SyntaxKind is a const enum, which verbatimModuleSyntax forbids importing.
  const OPEN_BRACE = 1
  const LINE_COMMENT = 12
  const BLOCK_COMMENT = 13
  const EOF = 17

  // A token is inert when its line is commented out with //, or, for JSONC documents (root object), when a
  // string-aware scan finds it inside a /* */ block or a trailing // comment. Strings such as "**/*.ts" or
  // "https://x" are not comments, and plain text (URLs, headers, prompts, markdown) is never scanned.
  export function commented(text: string, index: number, markdown?: boolean) {
    const lineStart = text.lastIndexOf("\n", index - 1) + 1
    if (text.slice(lineStart, index).trimStart().startsWith("//")) return true
    if (markdown || createScanner(text, true).scan() !== OPEN_BRACE) return false
    const scanner = createScanner(text, false)
    for (let kind = scanner.scan(); kind !== EOF; kind = scanner.scan()) {
      const start = scanner.getTokenOffset()
      if (start > index) return false
      if (kind !== LINE_COMMENT && kind !== BLOCK_COMMENT) continue
      if (index < start + scanner.getTokenLength()) return true
    }
    return false
  }

  export function env(name: string) {
    return !secret.has(name.toUpperCase())
  }

  function inside(root: string, file: string) {
    const rel = path.relative(root, file)
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
  }

  function check(file: string, token: string, scope?: FileScope) {
    if (!scope) return
    const root = realpathSync.native(scope.root)
    if (inside(root, file)) return
    throw new BlockedError(`blocked file reference outside project config scope: "${token}"`)
  }

  export async function read(filePath: string, scope?: FileScope & { token?: string }) {
    const file = await fs.open(filePath, "r")
    try {
      // Resolve the file the fd actually points at, then validate the scope and read through the same fd
      // (file.readFile) so the validated inode is exactly the one we read.
      //
      // On Linux /proc/self/fd/<fd> is the kernel's canonical path for the open fd, so realpath + read both
      // follow the fd — no path is re-resolved after open. On other platforms we cannot name the fd directly,
      // so we realpath the caller's path and then confirm, via fstat vs. stat on that resolved path, that it
      // still refers to the same inode as the open fd. If an attacker swapped the path between open and check,
      // the inodes differ and we reject rather than validating one inode while reading another.
      const target = process.platform === "linux" ? `/proc/self/fd/${file.fd}` : filePath
      const resolved = realpathSync.native(target)
      if (process.platform !== "linux" && scope) {
        const opened = await file.stat()
        const seen = statSync(resolved)
        if (opened.dev !== seen.dev || opened.ino !== seen.ino) {
          throw new BlockedError(`blocked file reference changed during read: "${scope.token ?? "{file:...}"}"`)
        }
      }
      check(resolved, scope?.token ?? "{file:...}", scope)
      if (/^\/proc\/.*\/environ$/.test(resolved)) throw new BlockedError("blocked process environment reference")
      return await file.readFile("utf-8")
    } finally {
      await file.close()
    }
  }
}
