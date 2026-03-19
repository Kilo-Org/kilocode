// kilocode_change - new file
import { $ } from "bun"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { FileIgnore } from "@/file/ignore"
import { Snapshot } from "@/snapshot"
import { Log } from "@/util/log"

export namespace WorktreeDiff {
  export const Item = Snapshot.FileDiff.extend({
    tracked: z.boolean(),
    generatedLike: z.boolean(),
    summarized: z.boolean(),
    stamp: z.string(),
  }).meta({
    ref: "WorktreeDiffItem",
  })
  export type Item = z.infer<typeof Item>

  type Status = NonNullable<Snapshot.FileDiff["status"]>

  type Meta = {
    file: string
    additions: number
    deletions: number
    status: Status
    tracked: boolean
    generatedLike: boolean
    stamp: string
  }

  function generatedLike(file: string) {
    return FileIgnore.match(file)
  }

  async function ancestor(dir: string, base: string, log: Log.Logger) {
    const result = await $`git merge-base HEAD ${base}`.cwd(dir).quiet().nothrow()
    if (result.exitCode !== 0) {
      log.warn("git merge-base failed", {
        exitCode: result.exitCode,
        stderr: result.stderr.toString().trim(),
        dir,
        base,
      })
      return
    }
    return result.stdout.toString().trim()
  }

  async function stats(dir: string, ancestor: string) {
    const result = await $`git -c core.quotepath=false diff --numstat --no-renames ${ancestor}`
      .cwd(dir)
      .quiet()
      .nothrow()
    const map = new Map<string, { additions: number; deletions: number }>()
    if (result.exitCode !== 0) return map

    for (const line of result.stdout.toString().trim().split("\n")) {
      if (!line) continue
      const parts = line.split("\t")
      const add = parts[0]
      const del = parts[1]
      const file = parts.slice(2).join("\t")
      if (!file) continue
      map.set(file, {
        additions: add === "-" ? 0 : parseInt(add || "0", 10),
        deletions: del === "-" ? 0 : parseInt(del || "0", 10),
      })
    }

    return map
  }

  async function list(dir: string, ancestor: string, log: Log.Logger): Promise<Meta[]> {
    const nameStatus = await $`git -c core.quotepath=false diff --name-status --no-renames ${ancestor}`
      .cwd(dir)
      .quiet()
      .nothrow()
    if (nameStatus.exitCode !== 0) return []

    const result: Meta[] = []
    const seen = new Set<string>()
    const stat = await stats(dir, ancestor)

    for (const line of nameStatus.stdout.toString().trim().split("\n")) {
      if (!line) continue
      const parts = line.split("\t")
      const code = parts[0]
      const file = parts.slice(1).join("\t")
      if (!file || !code) continue

      seen.add(file)
      const status = code === "A" ? "added" : code === "D" ? "deleted" : "modified"
      const counts = stat.get(file) ?? { additions: 0, deletions: 0 }
      result.push({
        file,
        additions: counts.additions,
        deletions: counts.deletions,
        status,
        tracked: true,
        generatedLike: generatedLike(file),
        stamp: status === "deleted" ? `deleted:${ancestor}` : await statStamp(dir, file),
      })
    }

    const untracked = await $`git ls-files --others --exclude-standard`.cwd(dir).quiet().nothrow()
    if (untracked.exitCode !== 0) {
      log.warn("git ls-files failed", {
        exitCode: untracked.exitCode,
        stderr: untracked.stderr.toString().trim(),
      })
      return result
    }

    const files = untracked.stdout.toString().trim()
    if (files) {
      log.info("untracked files found", { count: files.split("\n").length })
    }

    for (const file of files.split("\n")) {
      if (!file || seen.has(file)) continue
      const after = Bun.file(path.join(dir, file))
      if (!(await after.exists())) continue
      result.push({
        file,
        additions: await lineCount(path.join(dir, file)),
        deletions: 0,
        status: "added",
        tracked: false,
        generatedLike: generatedLike(file),
        stamp: await statStamp(dir, file),
      })
    }

    return result
  }

  async function detailMeta(dir: string, ancestor: string, file: string): Promise<Meta | undefined> {
    const tracked = await $`git ls-files --error-unmatch -- ${file}`.cwd(dir).quiet().nothrow()
    if (tracked.exitCode !== 0) {
      const after = Bun.file(path.join(dir, file))
      if (!(await after.exists())) return undefined
      return {
        file,
        additions: await lineCount(path.join(dir, file)),
        deletions: 0,
        status: "added",
        tracked: false,
        generatedLike: generatedLike(file),
        stamp: await statStamp(dir, file),
      }
    }

    const nameStatus = await $`git -c core.quotepath=false diff --name-status --no-renames ${ancestor} -- ${file}`
      .cwd(dir)
      .quiet()
      .nothrow()
    if (nameStatus.exitCode !== 0) return undefined
    const line = nameStatus.stdout.toString().trim().split("\n")[0]
    if (!line) return undefined

    const parts = line.split("\t")
    const code = parts[0]
    const pathPart = parts.slice(1).join("\t") || file
    if (!code) return undefined

    const numstat = await $`git -c core.quotepath=false diff --numstat --no-renames ${ancestor} -- ${file}`
      .cwd(dir)
      .quiet()
      .nothrow()
    const statLine = numstat.stdout.toString().trim().split("\n")[0]
    const stat = statLine
      ? (() => {
          const values = statLine.split("\t")
          return {
            additions: values[0] === "-" ? 0 : parseInt(values[0] || "0", 10),
            deletions: values[1] === "-" ? 0 : parseInt(values[1] || "0", 10),
          }
        })()
      : { additions: 0, deletions: 0 }

    const status = code === "A" ? "added" : code === "D" ? "deleted" : "modified"
    return {
      file: pathPart,
      additions: stat.additions,
      deletions: stat.deletions,
      status,
      tracked: true,
      generatedLike: generatedLike(pathPart),
      stamp: status === "deleted" ? `deleted:${ancestor}` : await statStamp(dir, pathPart),
    }
  }

  function lines(text: string) {
    if (!text) return 0
    return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length
  }

  async function lineCount(file: string) {
    let count = 0
    let size = 0
    let last = 10
    const reader = Bun.file(file).stream().getReader()

    while (true) {
      const result = await reader.read()
      if (result.done) break
      const bytes = result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value)
      size += bytes.length
      for (const byte of bytes) {
        if (byte === 10) count += 1
        last = byte
      }
    }

    if (size === 0) return 0
    return last === 10 ? count : count + 1
  }

  async function statStamp(dir: string, file: string) {
    const stat = await fs.stat(path.join(dir, file)).catch(() => undefined)
    if (!stat) return `missing:${file}`
    return `${stat.size}:${stat.mtimeMs}`
  }

  async function readBefore(dir: string, ancestor: string, file: string, status: Status) {
    if (status === "added") return ""
    const result = await $`git show ${ancestor}:${file}`.cwd(dir).quiet().nothrow()
    return result.exitCode === 0 ? result.stdout.toString() : ""
  }

  async function readAfter(dir: string, file: string, status: Status) {
    if (status === "deleted") return ""
    const result = Bun.file(path.join(dir, file))
    return (await result.exists()) ? await result.text() : ""
  }

  async function load(dir: string, ancestor: string, meta: Meta): Promise<Item> {
    const before = await readBefore(dir, ancestor, meta.file, meta.status)
    const after = await readAfter(dir, meta.file, meta.status)
    const additions = meta.status === "added" && meta.additions === 0 && !meta.tracked ? lines(after) : meta.additions
    return {
      file: meta.file,
      before,
      after,
      additions,
      deletions: meta.deletions,
      status: meta.status,
      tracked: meta.tracked,
      generatedLike: meta.generatedLike,
      summarized: false,
      stamp: meta.stamp,
    }
  }

  function summarize(meta: Meta): Item {
    return {
      file: meta.file,
      before: "",
      after: "",
      additions: meta.additions,
      deletions: meta.deletions,
      status: meta.status,
      tracked: meta.tracked,
      generatedLike: meta.generatedLike,
      summarized: true,
      stamp: meta.stamp,
    }
  }

  export async function summary(input: { dir: string; base: string; log?: Log.Logger }) {
    const log = input.log ?? Log.create({ service: "worktree-diff" })
    const base = input.base
    const ancestorHash = await ancestor(input.dir, base, log)
    if (!ancestorHash) return []
    log.info("merge-base resolved", { ancestor: ancestorHash.slice(0, 12) })
    const items = await list(input.dir, ancestorHash, log)
    log.info("diff summary complete", { totalFiles: items.length })
    return items.map(summarize)
  }

  export async function detail(input: { dir: string; base: string; file: string; log?: Log.Logger }) {
    const log = input.log ?? Log.create({ service: "worktree-diff" })
    const ancestorHash = await ancestor(input.dir, input.base, log)
    if (!ancestorHash) return undefined
    const item = await detailMeta(input.dir, ancestorHash, input.file)
    if (!item) return undefined
    return await load(input.dir, ancestorHash, item)
  }

  export async function full(input: { dir: string; base: string; log?: Log.Logger }) {
    const log = input.log ?? Log.create({ service: "worktree-diff" })
    const base = input.base
    const ancestorHash = await ancestor(input.dir, base, log)
    if (!ancestorHash) return []
    log.info("merge-base resolved", { ancestor: ancestorHash.slice(0, 12) })
    const items = await list(input.dir, ancestorHash, log)
    const result = await Promise.all(items.map((item) => load(input.dir, ancestorHash, item)))
    log.info("diff complete", { totalFiles: result.length })
    return result
  }
}
