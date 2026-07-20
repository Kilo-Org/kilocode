import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { MemorySchema } from "@kilocode/kilo-memory/schema"
import { MemoryFiles } from "@kilocode/kilo-memory/store"
import { Bus } from "../../../src/bus"
import { Filesystem } from "../../../src/util/filesystem"
import { KilocodeSystemPrompt } from "../../../src/kilocode/system-prompt"
import { MemoryMarker } from "../../../src/kilocode/memory/marker"
import { KiloSessionPrompt } from "../../../src/kilocode/session/prompt"
import { KiloToolRegistry } from "../../../src/kilocode/tool/registry"
import { KiloMemory } from "@kilocode/kilo-memory/effect"
import { MemoryPaths } from "@kilocode/kilo-memory/effect/paths"
import { MemoryEvents } from "../../../src/kilocode/memory/events"
import type { Provider } from "../../../src/provider/provider"
import type { InstanceContext } from "../../../src/project/instance-context"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionID } from "../../../src/session/schema"
import { provideTestInstance, tmpdir } from "../../fixture/fixture"

function model(): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: 100_000,
      output: 32_000,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { id: "test-model", npm: "@ai-sdk/openai", url: "" },
    options: {},
  } as Provider.Model
}

function ctx(dir: string): InstanceContext {
  return {
    directory: dir,
    worktree: dir,
    project: {
      id: ProjectV2.ID.make("project"),
      worktree: dir,
      vcs: "git",
      time: { created: 0, updated: 0 },
      sandboxes: [],
    },
  } as InstanceContext
}

async function withConfig<T>(dir: string, fn: () => Promise<T> | T) {
  const prior = Global.Path.config
  const data = Global.Path.data
  ;(Global.Path as { config: string }).config = dir
  ;(Global.Path as { data: string }).data = path.basename(dir) === ".kilo" ? path.dirname(dir) : dir
  try {
    return await fn()
  } finally {
    ;(Global.Path as { config: string }).config = prior
    ;(Global.Path as { data: string }).data = data
  }
}

async function withData<T>(dir: string, fn: () => Promise<T> | T) {
  const prior = Global.Path.data
  ;(Global.Path as { data: string }).data = dir
  try {
    return await fn()
  } finally {
    ;(Global.Path as { data: string }).data = prior
  }
}

async function withHome<T>(dir: string, fn: () => Promise<T> | T) {
  const prior = process.env.KILO_TEST_HOME
  process.env.KILO_TEST_HOME = dir
  try {
    return await fn()
  } finally {
    if (prior === undefined) delete process.env.KILO_TEST_HOME
    if (prior !== undefined) process.env.KILO_TEST_HOME = prior
  }
}

function expectRoot(root: string, dir: string, name: string) {
  expect(path.dirname(root)).toBe(path.join(dir, "memory"))
  expect(path.basename(root)).toMatch(new RegExp(`^${name}-[a-f0-9]{12}$`))
}

describe("KiloMemory integration", () => {
  test("resolves project memory to global data folder", async () => {
    await using tmp = await tmpdir()
    await withData(path.join(tmp.path, "data"), () => {
      const root = MemoryPaths.root({
        ctx: {
          directory: path.join("/repo", "packages", "opencode"),
          worktree: "/repo",
        },
      })

      expectRoot(root, path.join(tmp.path, "data"), "repo")
      expect(root).not.toContain(path.join("/repo", ".kilo", "memory"))
    })
  })

  test("resolves project memory under data when global config is xdg", async () => {
    await using tmp = await tmpdir()
    const data = path.join(tmp.path, "xdg", "kilo")
    await withData(data, () =>
      withHome(path.join(tmp.path, "home"), () => {
        const root = MemoryPaths.root({
          ctx: {
            directory: path.join("/repo", "packages", "opencode"),
            worktree: "/repo",
          },
        })

        expectRoot(root, data, "repo")
        expect(root).not.toContain(path.join("/repo", ".kilo", "memory"))
      }),
    )
  })

  test("enable from linked worktree writes repo state shared by sibling worktrees", async () => {
    await using tmp = await tmpdir()
    const main = path.join(tmp.path, "main")
    const work = path.join(tmp.path, "work")
    const next = path.join(tmp.path, "next")
    const global = path.join(tmp.path, "global")
    const git = path.join(main, ".git", "worktrees")
    await Filesystem.write(path.join(main, ".git", "HEAD"), "ref: refs/heads/main\n")
    await Filesystem.write(path.join(git, "work", "commondir"), "../..\n")
    await Filesystem.write(path.join(git, "next", "commondir"), "../..\n")
    await Filesystem.write(path.join(git, "work", "gitdir"), path.join(work, ".git"))
    await Filesystem.write(path.join(git, "next", "gitdir"), path.join(next, ".git"))
    await Filesystem.write(path.join(work, ".git"), `gitdir: ${path.join(git, "work")}\n`)
    await Filesystem.write(path.join(next, ".git"), `gitdir: ${path.join(git, "next")}\n`)

    await withData(global, async () => {
      await KiloMemory.enable({ ctx: { directory: work, worktree: work } })
      await KiloMemory.configure({ ctx: { directory: work, worktree: work }, settings: { autoConsolidate: false } })
      const status = await KiloMemory.status({ ctx: { directory: next, worktree: next } })

      expectRoot(status.root, global, "main")
      expect(status.state.enabled).toBe(true)
      expect(status.state.autoConsolidate).toBe(false)
      expect(await Filesystem.exists(path.join(main, ".kilo", "memory", "state.json"))).toBe(false)
      expect(await Filesystem.exists(path.join(work, ".kilo", "memory", "state.json"))).toBe(false)
      expect(await Filesystem.exists(path.join(next, ".kilo", "memory", "state.json"))).toBe(false)
    })
  })

  test("memory event status uses latest memory activity timestamp", () => {
    const base = MemorySchema.create()
    const event = MemoryEvents.status({
      root: "/tmp/kilo-memory",
      state: {
        ...base,
        stats: {
          ...base.stats,
          lastInjectedAt: Date.UTC(2026, 0, 1),
          lastTypedConsolidationAt: Date.UTC(2026, 0, 2),
        },
      },
      index: { bytes: 12, tokens: 3, truncated: false },
    })

    expect(event.project.updatedAt).toBe(Date.UTC(2026, 0, 2))
  })

  test("targeted recall metadata replaces startup memory badge marker", () => {
    const cache: MemoryMarker.Cache = {
      marker: { type: "startup", bytes: 20, tokens: 5, count: 1, files: ["project.md"], items: [] },
      marked: true,
    }

    MemoryMarker.recall({
      cache,
      result: {
        output: "Project memory recall output.",
        metadata: { sources: ["project.md", "environment.md"], count: 2 },
      },
    })

    expect(cache.marked).toBe(false)
    expect(cache.marker).toMatchObject({
      type: "recall",
      count: 2,
      files: ["project.md", "environment.md"],
    })
  })

  test("missing or disabled state does not enable the memory recall tool", async () => {
    await using tmp = await tmpdir()
    await withData(path.join(tmp.path, "data"), async () => {
      const memory = { directory: tmp.path, worktree: tmp.path }
      const root = MemoryPaths.root({ ctx: memory })

      expect(await KiloMemory.toolEnabled({ ctx: memory })).toBe(false)
      expect(await Filesystem.exists(root)).toBe(false)

      await KiloMemory.enable({ ctx: memory })
      expect(await KiloMemory.toolEnabled({ ctx: memory })).toBe(true)

      await KiloMemory.disable({ ctx: memory })
      expect(await KiloMemory.toolEnabled({ ctx: memory })).toBe(false)
    })
  })

  test("memory tool resolution degrades to false when the memory path is invalid", async () => {
    await using tmp = await tmpdir()
    await withConfig(path.join(tmp.path, "global", ".kilo"), async () => {
      const context = ctx(tmp.path)
      const root = MemoryPaths.root({ ctx: context })
      await fs.mkdir(path.dirname(root), { recursive: true })
      await Bun.write(root, "not a directory")

      const enabled = await Effect.runPromise(KiloSessionPrompt.memoryToolEnabled({ ctx: context }))

      expect(enabled).toBe(false)
    })
  })

  test("explicit memory events include session id when provided", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, ".kilo", "memory")
    const events: MemoryEvents.Status[] = []
    await KiloMemory.enable({ root })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const off = Bus.subscribe(MemoryEvents.Updated, (event) => events.push(event.properties))
        try {
          await KiloMemory.apply({
            root,
            sessionID: "ses_memory_event",
            tokens: 1234,
            ops: [{ action: "add", key: "event_route", text: "Route explicit memory events by session." }],
          })
        } finally {
          off()
        }
      },
    })

    expect(events.some((event) => event.sessionID === "ses_memory_event" && event.detail?.type === "saved")).toBe(true)
    expect(
      events.find((event) => event.sessionID === "ses_memory_event" && event.detail?.type === "saved")?.detail?.tokens,
    ).toBeUndefined()
  })

  test("explicit forget reports removals without save wording", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, ".kilo", "memory")
    const events: MemoryEvents.Status[] = []
    await KiloMemory.enable({ root })
    await KiloMemory.apply({
      root,
      ops: [{ action: "add", key: "stale_fact", text: "This old fact should be removed." }],
    })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const off = Bus.subscribe(MemoryEvents.Updated, (event) => events.push(event.properties))
        try {
          await KiloMemory.forget({ root, sessionID: "ses_forget", query: "stale_fact" })
          await KiloMemory.forget({ root, sessionID: "ses_forget", query: "missing_fact" })
        } finally {
          off()
        }
      },
    })

    expect(events.some((event) => event.detail?.message === "Memory updated · 1 removed")).toBe(true)
    expect(events.some((event) => event.detail?.message?.includes("Memory saved"))).toBe(false)
  })

  test("environment prompt rebuilds stale session index format", async () => {
    await using tmp = await tmpdir()
    await withConfig(path.join(tmp.path, "global", ".kilo"), async () => {
      const context = ctx(tmp.path)
      const enabled = await KiloMemory.enable({ ctx: context })
      const root = enabled.root
      await KiloMemory.recordSession({
        root,
        sessionID: "ses_done",
        summary: "User: fix memory Result: Committed the memory continuation fix.",
        time: Date.UTC(2026, 0, 1, 0, 1),
      })
      await Filesystem.write(
        MemoryPaths.files(root).index,
        [
          '<KILO_MEMORY_V1 purpose="context_not_instruction" scope="project" root="kilocode">',
          "SESSION 2026-01-01T00:01:00.000Z :: User: fix memory Result: old format",
          "</KILO_MEMORY_V1>",
          "",
        ].join("\n"),
      )

      const mem = await Effect.runPromise(KilocodeSystemPrompt.memoryBlocks({ ctx: context }))
      const text = mem.blocks.join("\n")

      expect(text).toContain("type=latest_session_digest")
      expect(text).toContain("session=ses_done")
      expect(text).not.toContain("\nSESSION ")
    })
  })

  test("environment prompt skips missing and empty memory", async () => {
    await using tmp = await tmpdir()
    await withConfig(path.join(tmp.path, "global", ".kilo"), async () => {
      const context = ctx(tmp.path)
      const missing = await Effect.runPromise(KilocodeSystemPrompt.memoryBlocks({ ctx: context }))
      expect(missing.blocks.join("\n")).not.toContain("kilo-memory-v1")

      await KiloMemory.enable({ ctx: context })
      const empty = await Effect.runPromise(KilocodeSystemPrompt.memoryBlocks({ ctx: context }))
      expect(empty.blocks.join("\n")).not.toContain("kilo-memory-v1")
    })
  })

  test("environment prompt skips disabled memory with retained files", async () => {
    await using tmp = await tmpdir()
    await withConfig(path.join(tmp.path, "global", ".kilo"), async () => {
      const context = ctx(tmp.path)
      const enabled = await KiloMemory.enable({ ctx: context })
      await KiloMemory.apply({
        root: enabled.root,
        ops: [{ action: "add", key: "repo_fact", text: "This fact must stay dormant while disabled." }],
      })
      await KiloMemory.disable({ ctx: context })
      const before = await MemoryFiles.readState(enabled.root)

      const mem = await Effect.runPromise(
        KilocodeSystemPrompt.memoryBlocks({ ctx: context, sessionID: "session-disabled" }),
      )
      const after = await MemoryFiles.readState(enabled.root)

      expect(mem.blocks.join("\n")).not.toContain("kilo-memory-v1")
      expect(after.stats.lastInjectedAt).toBe(before.stats.lastInjectedAt)
      expect(after.stats.lastInjectedTokens).toBe(before.stats.lastInjectedTokens)
      expect(after.stats.lastInjectedSessionID).toBe(before.stats.lastInjectedSessionID)
    })
  })

  test("explicit memory APIs reject while disabled", async () => {
    await using tmp = await tmpdir()
    await withConfig(path.join(tmp.path, "global", ".kilo"), async () => {
      const context = ctx(tmp.path)
      await KiloMemory.enable({ ctx: context })
      await KiloMemory.remember({
        ctx: context,
        key: "stable_fact",
        text: "Keep this saved fact.",
      })
      await KiloMemory.disable({ ctx: context })
      const before = await KiloMemory.show({ ctx: context })

      await expect(
        KiloMemory.remember({
          ctx: context,
          key: "disabled_fact",
          text: "Do not save while disabled.",
        }),
      ).rejects.toThrow("project memory is disabled")
      await expect(
        KiloMemory.correct({
          ctx: context,
          key: "stable_fact",
          text: "Do not correct while disabled.",
        }),
      ).rejects.toThrow("project memory is disabled")
      await expect(KiloMemory.forget({ ctx: context, query: "stable_fact" })).rejects.toThrow(
        "project memory is disabled",
      )
      await KiloMemory.rebuild({ ctx: context })
      const after = await KiloMemory.show({ ctx: context })

      expect(after.sources).toEqual(before.sources)
      expect(after.index).toBe(before.index)
      expect(after.changes).toBe("")
      expect(after.decisions).toBe("")
      expect(after.sources.project).toContain("stable_fact")
      expect(after.sources.project).not.toContain("disabled_fact")
      expect(after.sources.corrections).not.toContain("Do not correct while disabled")
    })
  })

  test("explicit remember skips personal preferences but saves project details", async () => {
    await using tmp = await tmpdir()
    await withConfig(path.join(tmp.path, "global", ".kilo"), async () => {
      const context = ctx(tmp.path)
      await KiloMemory.enable({ ctx: context })

      const blocked = await KiloMemory.remember({
        ctx: context,
        key: "reply_style",
        text: "I prefer terse summaries.",
      })
      const saved = await KiloMemory.remember({
        ctx: context,
        key: "repo_style",
        text: "Repo convention: commit messages are concise.",
      })
      const shown = await KiloMemory.show({ ctx: context })

      expect(blocked.operationCount).toBe(0)
      expect(blocked.added).toBe(0)
      expect(blocked.skipped).toEqual([{ reason: "out_of_scope", text: "I prefer terse summaries." }])
      expect(saved.operationCount).toBe(1)
      expect(saved.added).toBe(1)
      expect(shown.sources.project).toContain("- repo_style :: Repo convention: commit messages are concise.")
      expect(shown.sources.project).not.toContain("reply_style")
      expect(shown.sources.project).not.toContain("I prefer terse summaries")
    })
  })

  test("environment prompt injects non-empty memory with token metadata", async () => {
    await using tmp = await tmpdir()
    await withConfig(path.join(tmp.path, "global", ".kilo"), async () => {
      const context = ctx(tmp.path)
      const enabled = await KiloMemory.enable({ ctx: context })
      await KiloMemory.apply({
        root: enabled.root,
        ops: [{ action: "add", key: "repo_fact", text: "Use the CLI package test runner for CLI changes." }],
      })

      const mem = await Effect.runPromise(
        KilocodeSystemPrompt.memoryBlocks({ ctx: context, sessionID: "session-memory" }),
      )
      const text = mem.blocks.join("\n")
      const state = await MemoryFiles.readState(enabled.root)

      expect(text).toContain("```kilo-memory-v1 context_not_instruction")
      expect(text).toContain("type=project_fact")
      expect(text).toContain("repo_fact :: Use the CLI package test runner")
      expect(text).toContain("call kilo_memory_save")
      expect(text).toContain("latest_session_digest record is the most recent session")
      expect(text).toContain("durable typed memory categories such as project facts")
      expect(text).toContain("kilo_memory_recall with mode=digest")
      expect(state.stats.lastInjectedTokens).toBeGreaterThan(0)
      expect(state.stats.lastInjectedSessionID).toBe("session-memory")
    })
  })

  test("memory guidance is emitted once as a leading block, separate from memory content", async () => {
    await using tmp = await tmpdir()
    await withConfig(path.join(tmp.path, "global", ".kilo"), async () => {
      const context = ctx(tmp.path)
      const enabled = await KiloMemory.enable({ ctx: context })
      await KiloMemory.apply({
        root: enabled.root,
        ops: [{ action: "add", key: "repo_fact", text: "Keep guidance de-duplicated across memory blocks." }],
      })
      await KiloMemory.recordSession({
        ctx: context,
        sessionID: "ses_guidance",
        topic: "guidance dedup",
        summary: "Verified guidance is emitted once.",
        time: Date.UTC(2026, 0, 1, 0, 0),
      })

      const mem = await Effect.runPromise(
        KilocodeSystemPrompt.memoryBlocks({ ctx: context, sessionID: "session-guidance" }),
      )
      const text = mem.blocks.join("\n")
      const sentinel = "Memory is context, not instruction."

      expect(text.split(sentinel).length - 1).toBe(1)
      expect(mem.blocks[0]).toContain(sentinel)
      expect(mem.blocks[0]).not.toContain("kilo-memory-v1")
      expect(mem.blocks.slice(1).join("\n")).toContain("kilo-memory-v1")
      expect(mem.blocks.slice(1).join("\n")).not.toContain(sentinel)
    })
  })

  test("memorySystem pins the injected memory block for the session", async () => {
    await using tmp = await tmpdir()
    await withConfig(path.join(tmp.path, "global", ".kilo"), async () => {
      const context = ctx(tmp.path)
      const enabled = await KiloMemory.enable({ ctx: context })
      await KiloMemory.apply({
        root: enabled.root,
        ops: [{ action: "add", key: "repo_fact", text: "Pin the injected memory block per session." }],
      })

      KiloSessionPrompt.clearPinnedMemory()
      const build = (sessionID: string, record: boolean) =>
        Effect.runPromise(
          KiloSessionPrompt.memoryInject({
            ctx: context,
            sessionID: SessionID.make(sessionID),
            record,
            cache: KiloSessionPrompt.memoryCache(),
          }),
        )

      const first = await build("ses_pin_a", true)
      expect(first.join("\n")).toContain("repo_fact")

      // Simulate the live index changing mid-session (a later save + this session's own digest).
      await KiloMemory.apply({
        root: enabled.root,
        ops: [{ action: "add", key: "later_fact", text: "This later write must not change the pinned block." }],
      })
      await KiloMemory.recordSession({
        ctx: context,
        sessionID: "ses_pin_a",
        topic: "own digest",
        summary: "This session's own digest must be excluded from its pinned block.",
        time: Date.UTC(2026, 0, 3, 0, 0),
      })

      const second = await build("ses_pin_a", false)
      // Same session -> byte-identical pinned block, excludes later writes and its own digest.
      expect(second).toEqual(first)
      expect(second.join("\n")).not.toContain("later_fact")
      expect(second.join("\n")).not.toContain("own digest")

      // New session -> fresh block reflecting the current index.
      const third = await build("ses_pin_b", false)
      expect(third.join("\n")).toContain("later_fact")
    })
  })

  test("memorySystem refreshes pinned block when memory is toggled", async () => {
    await using tmp = await tmpdir()
    await withConfig(path.join(tmp.path, "global", ".kilo"), async () => {
      const context = ctx(tmp.path)
      const enabled = await KiloMemory.enable({ ctx: context })
      const root = enabled.root
      await KiloMemory.apply({
        root,
        ops: [{ action: "add", key: "toggle_fact", text: "Toggled memory should update the session prompt." }],
      })
      await KiloMemory.disable({ ctx: context })
      KiloToolRegistry.invalidateMemoryEnabled(root)

      KiloSessionPrompt.clearPinnedMemory()
      const build = () =>
        Effect.runPromise(
          KiloSessionPrompt.memoryInject({
            ctx: context,
            sessionID: SessionID.make("ses_toggle"),
            record: false,
            cache: KiloSessionPrompt.memoryCache(),
          }),
        )

      const disabled = await build()
      expect(disabled.join("\n")).not.toContain("toggle_fact")

      await KiloMemory.enable({ ctx: context })
      KiloToolRegistry.invalidateMemoryEnabled(root)
      const restored = await build()
      expect(restored.join("\n")).toContain("toggle_fact")

      await KiloMemory.disable({ ctx: context })
      KiloToolRegistry.invalidateMemoryEnabled(root)
      const removed = await build()
      expect(removed.join("\n")).not.toContain("toggle_fact")
    })
  })

  test("memorySystem refreshes verbose marker state for each turn", async () => {
    await using tmp = await tmpdir()
    await withConfig(path.join(tmp.path, "global", ".kilo"), async () => {
      const context = ctx(tmp.path)
      await KiloMemory.enable({ ctx: context })
      KiloSessionPrompt.clearPinnedMemory()

      const first = KiloSessionPrompt.memoryCache()
      await Effect.runPromise(
        KiloSessionPrompt.memoryInject({
          ctx: context,
          sessionID: SessionID.make("ses_verbose"),
          record: false,
          cache: first,
        }),
      )
      expect(first.verbose).toBe(false)

      await KiloMemory.configure({ ctx: context, settings: { verbose: true } })
      const second = KiloSessionPrompt.memoryCache()
      await Effect.runPromise(
        KiloSessionPrompt.memoryInject({
          ctx: context,
          sessionID: SessionID.make("ses_verbose"),
          record: false,
          cache: second,
        }),
      )
      expect(second.verbose).toBe(true)
    })
  })

  test("environment prompt can render memory without recording another injection", async () => {
    await using tmp = await tmpdir()
    await withConfig(path.join(tmp.path, "global", ".kilo"), async () => {
      const context = ctx(tmp.path)
      const enabled = await KiloMemory.enable({ ctx: context })
      await KiloMemory.apply({
        root: enabled.root,
        ops: [{ action: "add", key: "repo_fact", text: "Keep memory prompt text stable across tool steps." }],
      })

      await Effect.runPromise(KilocodeSystemPrompt.memoryBlocks({ ctx: context, sessionID: "session-memory" }))
      const before = await MemoryFiles.readState(enabled.root)
      await Effect.runPromise(
        KilocodeSystemPrompt.memoryBlocks({
          ctx: context,
          sessionID: "session-memory",
          record: false,
        }),
      )
      const after = await MemoryFiles.readState(enabled.root)

      expect(after.stats.lastInjectedAt).toBe(before.stats.lastInjectedAt)
      expect(after.stats.lastInjectedTokens).toBe(before.stats.lastInjectedTokens)
      expect(after.stats.lastInjectedSessionID).toBe(before.stats.lastInjectedSessionID)
    })
  })
})
