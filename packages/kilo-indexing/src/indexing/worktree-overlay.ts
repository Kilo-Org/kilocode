import { createHash } from "crypto"
import { readFile } from "fs/promises"
import path from "path"
import type { VectorStoreSearchResult } from "./interfaces/vector-store"

const normalize = (value: string) => value.replaceAll("\\", "/")

export class WorktreeOverlay {
  readonly shadows = new Set<string>()
  readonly blocked = new Set<string>()
  ready = false

  constructor(
    readonly workspacePath: string,
    readonly baselinePath: string,
    readonly baseline: ReadonlyMap<string, string>,
  ) {}

  relative(filePath: string): string | undefined {
    const rel = path.isAbsolute(filePath) ? path.relative(this.workspacePath, filePath) : filePath
    if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return
    return normalize(path.normalize(rel))
  }

  baselineHash(filePath: string): string | undefined {
    const rel = this.relative(filePath)
    if (!rel) return
    return this.baseline.get(rel)
  }

  seed(): Record<string, string> {
    return Object.fromEntries(
      [...this.baseline].map(([filePath, hash]) => [path.join(this.workspacePath, ...filePath.split("/")), hash]),
    )
  }

  prepare(): void {
    this.ready = false
    this.shadows.clear()
    this.blocked.clear()
  }

  block(filePath: string): void {
    const rel = this.relative(filePath)
    if (rel) this.blocked.add(rel)
  }

  settle(filePath: string, hash: string | undefined, pending = false): void {
    const rel = this.relative(filePath)
    if (!rel) return

    const baseline = this.baseline.get(rel)
    if (baseline !== undefined && baseline !== hash) this.shadows.add(rel)
    if (baseline === undefined || baseline === hash) this.shadows.delete(rel)
    if (!pending) this.blocked.delete(rel)
  }

  reconcile(current: Readonly<Record<string, string>>): void {
    this.shadows.clear()
    for (const [filePath, hash] of this.baseline) {
      const absolute = path.join(this.workspacePath, ...filePath.split("/"))
      if (current[absolute] !== hash) this.shadows.add(filePath)
    }
    this.ready = true
  }

  async baselineResult(result: VectorStoreSearchResult, checks: Map<string, Promise<boolean>>): Promise<boolean> {
    const filePath = result.payload?.filePath
    if (typeof filePath !== "string") return false
    const rel = this.relative(filePath)
    if (!rel || this.shadows.has(rel) || this.blocked.has(rel)) return false

    const expected = this.baseline.get(rel)
    if (!expected || result.payload?.fileHash !== expected) return false
    const existing = checks.get(rel)
    const valid =
      existing ??
      readFile(path.join(this.workspacePath, ...rel.split("/")), "utf-8")
        .then((content) => createHash("sha256").update(content).digest("hex") === expected)
        .catch(() => false)
    checks.set(rel, valid)
    return valid
  }

  deltaResult(result: VectorStoreSearchResult): boolean {
    const filePath = result.payload?.filePath
    if (typeof filePath !== "string") return false
    const rel = this.relative(filePath)
    if (!rel) return false
    return !this.blocked.has(rel)
  }
}
