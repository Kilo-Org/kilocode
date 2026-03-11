// kilocode_change - new file
import { $ } from "bun"
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
        additions: 0,
        deletions: 0,
        status: "added",
        tracked: false,
        generatedLike: generatedLike(file),
      })
    }

    return result
  }

  function lines(text: string) {
    if (!text) return 0
    return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length
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
    const items = await list(input.dir, ancestorHash, log)
    const item = items.find((item) => item.file === input.file)
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
