import { expect, test } from "bun:test"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Memory } from "../src/memory"
import { MemorySchema } from "../src/schema"
import { MemoryFiles } from "../src/storage/store"
import { MemoryService } from "../src/effect/service"
import { MemoryTurn } from "../src/effect/turn"
import { Effect } from "effect"

async function withRoot(run: (root: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-memory-v2-"))
  const root = path.join(directory, "memory")
  try {
    await run(root)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("starts with automatic consolidation explicitly disabled", () => {
  expect(MemorySchema.create().autoConsolidate).toBe(false)
})

test("does not repair malformed state during an ordinary read", async () => {
  await withRoot(async (root) => {
    await Memory.enable({ root })
    await writeFile(path.join(root, "state.json"), "{\n", "utf8")

    await expect(MemoryFiles.readState(root)).rejects.toThrow()
    expect(await Bun.file(path.join(root, "state.json")).text()).toBe("{\n")
    expect((await readdir(root)).some((file) => file.startsWith("state.json.bad-"))).toBe(false)
  })
})

test("parses preview state in memory and preserves existing source bytes until a deliberate mutation", async () => {
  await withRoot(async (root) => {
    await Memory.enable({ root })
    const project = "# Project Memory\n\n## Facts\n- package_runtime :: Use Bun.\n"
    const preview = '{\n  "version": 1,\n  "enabled": true,\n  "scope": "project",\n  "autoConsolidate": false\n}\n'
    await writeFile(path.join(root, "project.md"), project, "utf8")
    await writeFile(path.join(root, "state.json"), preview, "utf8")

    const parsed = await MemoryFiles.readState(root)
    expect(parsed.stats.lastConsolidatedMessageID).toBeNull()
    expect(await Bun.file(path.join(root, "state.json")).text()).toBe(preview)
    expect(await Bun.file(path.join(root, "project.md")).text()).toBe(project)

    await Memory.configure({ root, settings: { autoConsolidate: true } })
    const next = await Bun.file(path.join(root, "state.json")).text()
    expect(next).not.toBe(preview)
    expect(await Bun.file(path.join(root, "project.md")).text()).toBe(project)
  })
})

test("does not consolidate child sessions", async () => {
  let calls = 0
  await Effect.runPromise(
    MemoryTurn.close({
      root: "/tmp/kilo-memory-child-session",
      sessionID: "ses_memory_child",
      reason: "completed",
      session: {
        get: () => Effect.succeed({ parentID: "ses_memory_parent" }),
        readTurn: () => Effect.succeed(undefined),
      },
      model: {
        resolve: () => Effect.succeed({ handle: undefined }),
        run: async () => {
          calls += 1
          return { text: "{}", usage: undefined }
        },
      },
    }).pipe(Effect.provide(MemoryService.layer)),
  )
  expect(calls).toBe(0)
})
