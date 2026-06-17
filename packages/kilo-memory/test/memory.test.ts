import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm, symlink, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { Memory } from "../src/memory"
import { MemoryPaths } from "../src/storage/paths"
import { MemoryRecall } from "../src/recall/recall"

async function tmp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-memory-"))
  return {
    dir,
    root: path.join(dir, "memory"),
    async done() {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

describe("memory facade", () => {
  test("enables, writes, indexes, and recalls project memory", async () => {
    const t = await tmp()
    try {
      const enabled = await Memory.enable({ root: t.root })
      const status = await Memory.status({ root: t.root })

      expect(enabled.state.enabled).toBe(true)
      expect(status.exists.state).toBe(true)
      expect(status.exists.index).toBe(true)

      await Memory.remember({
        root: t.root,
        file: "environment.md",
        section: "Commands",
        text: "Run CLI tests from packages/opencode.",
      })

      const ctx = await Memory.context({ root: t.root, record: false })
      const recall = await Memory.recall({ root: t.root, query: "CLI tests packages opencode" })

      expect(ctx.blocks[0]?.text).toContain("packages/opencode")
      expect(recall.result?.block).toContain("packages/opencode")
    } finally {
      await t.done()
    }
  })

  test("keeps Unicode keys and non-English text searchable", async () => {
    const t = await tmp()
    try {
      await Memory.enable({ root: t.root })
      await Memory.remember({
        root: t.root,
        key: "設定",
        text: "日本語の設定は packages/kilo-vscode に保存します。",
      })

      const shown = await Memory.show({ root: t.root })
      const recall = await Memory.recall({ root: t.root, query: "日本語 設定 kilo-vscode" })

      expect(shown.sources.project).toContain("設定")
      expect(recall.result?.block).toContain("日本語")
    } finally {
      await t.done()
    }
  })

  test("does not expose natural-language recall intent predicates", () => {
    const recall = MemoryRecall as unknown as Record<string, unknown>

    expect("shouldRecall" in recall).toBe(false)
    expect("direct" in recall).toBe(false)
    expect("explicit" in recall).toBe(false)
    expect("continuation" in recall).toBe(false)
  })

  test("rejects current-session digest reads", async () => {
    const t = await tmp()
    try {
      await Memory.enable({ root: t.root })
      await Memory.recordSession({
        root: t.root,
        sessionID: "same-session",
        summary: "Captured deployment checklist for the release.",
        time: Date.UTC(2026, 0, 1, 0, 0),
      })

      const current = await MemoryRecall.search({
        root: t.root,
        query: "deployment checklist",
        mode: "digest",
        sessionID: "same-session",
        currentSessionID: "same-session",
      })
      const prior = await MemoryRecall.search({
        root: t.root,
        query: "deployment checklist",
        mode: "digest",
        sessionID: "same-session",
        currentSessionID: "other-session",
      })

      expect(current).toBeUndefined()
      expect(prior?.block).toContain("deployment checklist")
    } finally {
      await t.done()
    }
  })

  test("recovers corrupted state into a safe disabled state", async () => {
    const t = await tmp()
    try {
      await Memory.enable({ root: t.root })
      await writeFile(MemoryPaths.files(t.root).state, "{", "utf8")

      const status = await Memory.status({ root: t.root })
      const files = await readdir(t.root)

      expect(status.state.enabled).toBe(false)
      expect(files.some((file) => file.startsWith("state.json.bad-"))).toBe(true)
    } finally {
      await t.done()
    }
  })

  test("rejects symlinked memory roots", async () => {
    const t = await tmp()
    try {
      const target = path.join(t.dir, "target")
      const link = path.join(t.dir, "link")
      await Memory.enable({ root: target })
      await symlink(target, link)

      await expect(Memory.enable({ root: link })).rejects.toThrow("memory path rejects symlink")
    } finally {
      await t.done()
    }
  })
})
