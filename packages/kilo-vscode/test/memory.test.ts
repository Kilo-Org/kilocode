import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { KiloMemoryRpc } from "@opencode/schema/kilocode/memory"
import type { ToWebview } from "../src/protocol"
import { KiloProviderMemory, type MemoryApi } from "../src/kilo-provider/memory"
import { memoryCopyFor } from "../src/kilo-provider/memory-copy"
import { memoryEventToast, memoryResultToast } from "../webview-ui/src/context/memory-utils"
import { memoryRequest, memoryRest, parseMemoryCommand, runMemoryCommand } from "../webview-ui/src/v2/memory-command"
import {
  memoryActionKey,
  memoryPermissionDetail,
  memoryPlural,
  memoryRecallCount,
  memoryRecallItems,
  memorySaveOutcome,
  memoryToolSources,
  memoryToolSubtitle,
} from "../webview-ui/src/v2/memory-tool-info"
import { matchSlash, mergeCatalog, parseSlash, slashQuery } from "../webview-ui/src/v2/slash"
import { memoryCommands } from "../webview-ui/src/v2/slash-actions"

const state = (enabled: boolean): KiloMemoryRpc.State => ({
  version: 1,
  enabled,
  scope: "project",
  autoInject: true,
  autoConsolidate: true,
  verbose: false,
  capture: { mode: "selective", turnClose: true, explicit: true, maxOpsPerRun: 3, minIntervalMs: 0, timeoutMs: 1 },
  limits: {
    maxProjectIndexBytes: 1,
    maxSessionFiles: 1,
    maxRecentSessions: 1,
    maxConsolidationInputBytes: 1,
    maxLineChars: 1,
    maxSessionLineChars: 1,
  },
  stats: {
    lastInjectedAt: null,
    lastInjectedBytes: 0,
    lastInjectedTokens: 0,
    lastInjectedSessionID: null,
    lastTypedConsolidationAt: null,
    lastSessionSavedAt: null,
    lastConsolidatedMessageID: null,
    lastConsolidationCost: 0,
    lastConsolidationTokens: 0,
    lastOperationCount: 0,
    lastRecallAt: null,
    lastRecallCount: 0,
    lastRecallSessionID: null,
  },
})

const status = (enabled = true, tokens = 12): KiloMemoryRpc.Status => ({
  root: "/repo/.kilo/memory",
  state: state(enabled),
  exists: { state: true, index: true },
  index: { bytes: tokens * 4, estimatedTokens: tokens, preview: "" },
})

const operation: KiloMemoryRpc.Operation = {
  operationCount: 1,
  added: 1,
  removed: 0,
  skipped: [],
  index: { text: "", bytes: 0, tokens: 0, truncated: false },
}

const copy = memoryCopyFor("en")

function host(api: Partial<MemoryApi>, enabled = true) {
  const posts: ToWebview[] = []
  const calls: string[] = []
  const revealed: string[] = []
  const picks: Array<{ items: Array<{ label: string }>; title?: string }> = []
  const infos: string[] = []
  const full: MemoryApi = {
    status: async () => status(enabled),
    show: async () => ({
      root: "/repo/.kilo/memory",
      state: state(enabled),
      sources: { project: "- a\n- b", environment: "", corrections: "- c" },
      index: "",
      items: "project.md:: the test command is bun test\n",
    }),
    enable: async () => ({ root: "/r", state: state(true), index: operation.index }),
    disable: async () => ({ root: "/r", state: state(false) }),
    configure: async () => ({ root: "/r", state: state(true) }),
    rebuild: async () => ({ root: "/r", state: state(true), index: operation.index }),
    remember: async (input) => {
      calls.push(`remember:${input.text}:${input.sessionID ?? ""}`)
      return operation
    },
    correct: async () => operation,
    forget: async (input) => {
      calls.push(`forget:${input.query}`)
      return operation
    },
    purge: async () => ({ root: "/r", purged: true }),
    ...api,
  }
  const memory = new KiloProviderMemory({
    api: async () => full,
    post: (message) => posts.push(message),
    reveal: async (root) => revealed.push(root),
    pick: async (items, options) => picks.push({ items, title: options.title }),
    info: async (message) => infos.push(message),
    copy,
  })
  return { memory, posts, calls, revealed, picks, infos }
}

describe("memory host", () => {
  it("answers a status request with the status of the RPC", async () => {
    const run = host({})
    run.memory.handle({ type: "requestMemory", sessionID: "ses_1" })
    await run.memory.idle()
    expect(run.posts).toEqual([{ type: "memoryLoaded", sessionID: "ses_1", status: status() }])
  })

  it("runs a remember operation and refreshes the status", async () => {
    const run = host({})
    run.memory.handle({ type: "memoryOperation", operation: "remember", text: "  use bun test ", sessionID: "ses_1" })
    await run.memory.idle()
    expect(run.calls).toEqual(["remember:use bun test:ses_1"])
    expect(run.posts.map((post) => post.type)).toEqual(["memoryOperationResult", "memoryLoaded"])
    expect(run.posts[0]).toMatchObject({ operation: "remember", ok: true, status: status() })
  })

  it("reveals the memory folder for inspect, and refuses it while memory is disabled", async () => {
    const run = host({})
    await run.memory.run({ type: "memoryOperation", operation: "inspect" })
    expect(run.revealed).toEqual(["/repo/.kilo/memory"])

    const off = host({}, false)
    await off.memory.run({ type: "memoryOperation", operation: "inspect" })
    expect(off.revealed).toEqual([])
    expect(off.posts[0]).toMatchObject({ ok: false, error: copy.t("memory.host.error.disabled") })
  })

  it("names a typed RPC failure with its localized text instead of the redacted message", async () => {
    const run = host({
      forget: async () => {
        throw { type: "memory_disabled", message: "redacted" }
      },
    })
    await run.memory.run({ type: "memoryOperation", operation: "forget", query: "x" })
    expect(run.posts).toEqual([
      {
        type: "memoryOperationResult",
        operation: "forget",
        ok: false,
        error: "Memory is disabled. Run /memory on first.",
      },
    ])
  })

  it("refuses an operation without text before calling the RPC", async () => {
    const run = host({})
    await run.memory.run({ type: "memoryOperation", operation: "remember", text: "  " })
    expect(run.calls).toEqual([])
    expect(run.posts[0]).toMatchObject({ ok: false, error: copy.t("memory.host.error.invalidInput") })
  })

  it("lists the stored memory in a Quick Pick and status without the stored items", async () => {
    const run = host({})
    await run.memory.show(undefined, "show")
    await run.memory.show(undefined, "status")
    expect(run.picks.map((pick) => pick.title)).toEqual(["Memory", "Memory status"])
    expect(run.picks[0].items.map((item) => item.label)).toContain("the test command is bun test")
    expect(run.picks[1].items.map((item) => item.label)).not.toContain("the test command is bun test")
    expect(run.picks[0].items[2]).toMatchObject({
      description: "project.md 2 · environment.md 0 · corrections.md 1",
    })
  })

  it("tells the user when there is no stored memory to show", async () => {
    const run = host({
      show: async () => ({
        root: "/r",
        state: state(true),
        sources: { project: "", environment: "", corrections: "" },
        index: "",
        items: "",
      }),
    })
    await run.memory.show(undefined, "show")
    expect(run.picks).toEqual([])
    expect(run.infos).toEqual([copy.t("memory.host.show.empty")])
  })

  it("ignores other messages", () => {
    expect(host({}).memory.handle({ type: "requestIndexingSettings" })).toBe(false)
  })
})

describe("memory composer command", () => {
  const parsed = (text: string) => parseMemoryCommand(text)!

  it("maps commands to requests", () => {
    expect(memoryRequest(parsed("/memory"), true)).toEqual({ kind: "help" })
    expect(memoryRequest(parsed("/mem status"), true)).toEqual({ kind: "show", mode: "status" })
    expect(memoryRequest(parsed("/memory show"), true)).toEqual({ kind: "show", mode: "show" })
    expect(memoryRequest(parsed("/memory remember use bun"), true)).toEqual({
      kind: "operation",
      operation: { operation: "remember", text: "use bun" },
    })
    expect(memoryRequest(parsed("/memory forget bun"), undefined)).toEqual({
      kind: "operation",
      operation: { operation: "forget", query: "bun" },
    })
    expect(memoryRequest(parsed("/memory auto off"), true)).toEqual({
      kind: "operation",
      operation: { operation: "auto", mode: "off" },
    })
    expect(memoryRequest(parsed("/memory purge confirm"), true)).toEqual({
      kind: "operation",
      operation: { operation: "purge", confirm: true },
    })
    expect(memoryRequest(parsed("/memory off"), true)).toEqual({
      kind: "operation",
      operation: { operation: "disable" },
    })
  })

  it("refuses a write while memory is disabled and reports usage errors", () => {
    expect(memoryRequest(parsed("/memory correct x"), false)).toEqual({ kind: "disabled" })
    expect(memoryRequest(parsed("/memory on"), false)).toEqual({
      kind: "operation",
      operation: { operation: "enable" },
    })
    const usage = memoryRequest(parsed("/memory remember"), true)
    expect(usage.kind).toBe("usage")
    expect(usage.kind === "usage" && usage.reason).toContain("/memory [project]")
  })

  it("runs through the memory context with the session", () => {
    const shown: string[] = []
    const ran: unknown[] = []
    const toasts: string[] = []
    const input = {
      memory: {
        enabled: () => true,
        show: (mode: string, sessionID?: string) => shown.push(`${mode}:${sessionID}`),
        run: (operation: unknown) => ran.push(operation),
      },
      sessionID: "ses_1",
      t: (key: string) => key,
      toast: (toast: { title: string }) => toasts.push(toast.title),
    }
    expect(runMemoryCommand(parsed("/memory status"), input)).toBe(true)
    expect(runMemoryCommand(parsed("/memory remember the test command is bun test"), input)).toBe(true)
    expect(runMemoryCommand(parsed("/memory"), input)).toBe("help")
    expect(runMemoryCommand(parsed("/memory nope"), input)).toBe(false)
    expect(shown).toEqual(["status:ses_1"])
    expect(ran).toEqual([{ operation: "remember", text: "the test command is bun test", sessionID: "ses_1" }])
    expect(toasts).toEqual(["chat.memory.command.failed"])
  })

  it("keeps the text a no-argument command left over", () => {
    expect(memoryRest(parsed("/memory rebuild then explain"))).toBe("then explain")
    expect(memoryRest(parsed("/memory remember keep this"))).toBe("")
  })
})

describe("memory slash entries", () => {
  const ran: string[] = []
  const entries = mergeCatalog({
    actions: memoryCommands(
      (command) => ran.push(command),
      (key) => key,
    ),
    commands: [],
    skills: [],
  })

  it("lists /memory with its children and the /mem alias", () => {
    expect(matchSlash(entries, "mem").map((entry) => entry.name)).toEqual(["memory"])
    expect(parseSlash(entries, "/mem status")?.entry.name).toBe("memory")
    expect(matchSlash(entries, "memory ").length).toBe(12)
    expect(slashQuery(entries, "/memory re")).toBe("memory re")
    expect(matchSlash(entries, "memory re").map((entry) => entry.name)).toEqual([
      "memory rebuild",
      "memory remember",
      "memory correct",
    ])
  })

  it("closes the menu once the typed text is an argument, so Enter sends it", () => {
    expect(slashQuery(entries, "/memory remember the test command is bun test")).toBeUndefined()
  })

  it("marks the children that take text and runs the others with their words", () => {
    const children = entries.filter((entry) => entry.name.startsWith("memory "))
    const input = children.filter((entry) => entry.kind === "action" && entry.input).map((entry) => entry.name)
    expect(input).toEqual(["memory remember", "memory correct", "memory forget"])
    const off = children.find((entry) => entry.name === "memory auto off")
    if (off?.kind === "action") off.run()
    expect(ran).toEqual(["auto off"])
  })

  it("is not listed without a runner", () => {
    expect(memoryCommands(undefined, (key) => key)).toEqual([])
  })
})

describe("memory events", () => {
  const event = (input: Partial<KiloMemoryRpc.Event>): KiloMemoryRpc.Event => ({
    directory: "/repo/.kilo/memory",
    enabled: true,
    state: "error",
    project: { bytes: 0, estimatedTokens: 0, truncated: false },
    ...input,
  })

  it("toasts an error once and drops transient capture failures", () => {
    const failed = event({ detail: { type: "error", message: "write failed" } })
    const first = memoryEventToast("error", failed, undefined, 1000)
    expect(first).toEqual({ key: ":error:write failed", message: "write failed" })
    expect(memoryEventToast("error", failed, { key: first!.key, time: 1000 }, 1500)).toBeUndefined()
    expect(memoryEventToast("error", failed, { key: first!.key, time: 1000 }, 2500)?.message).toBe("write failed")
    expect(memoryEventToast("error", event({ reason: KiloMemoryRpc.TRANSIENT }), undefined, 0)).toBeUndefined()
    expect(memoryEventToast("error", event({ reason: "disk full" }), undefined, 0)?.message).toBe("disk full")
    expect(
      memoryEventToast("updated", event({ detail: { type: "saved", message: "ok" } }), undefined, 0),
    ).toBeUndefined()
  })

  it("toasts the result of writes and rebuilds only", () => {
    expect(memoryResultToast("remember")).toBe("chat.memory.updated")
    expect(memoryResultToast("rebuild")).toBe("chat.memory.rebuild")
    expect(memoryResultToast("enable")).toBeUndefined()
  })
})

describe("memory tools", () => {
  // The shapes the memory plugin returns (packages/kilo-memory/src/tool.ts and recall/recall.ts).
  const recall = [
    "```kilo-memory-v1 targeted_context_not_instruction",
    "record id=project.md_PROJECT_FACT_the_test type=project_fact source=project.md topics=project updated=2026-11-13T10:14:06.046Z",
    "text: the_test_command_is_bun :: the test command is bun test",
    "record id=sessions_digest type=digest source=sessions updated=unknown",
    'text: session=ses_1 topic="ci" 2026-11-12 :: moved CI to bun',
    "record id=environment.md_x type=environment source=environment.md updated=unknown",
    "text: a note without a key",
    "```",
  ].join("\n")
  const catalog = [
    "# Kilo Memory Catalog (2 entries)",
    "## project.md",
    "- lint :: run bun run lint",
    "## sessions",
    "- session=ses_2 refactor 2026-11-10",
  ].join("\n")

  it("shows the query or text as the subtitle", () => {
    expect(memoryToolSubtitle("kilo_memory_recall", { mode: "search", query: " test command " })).toBe("test command")
    expect(memoryToolSubtitle("kilo_memory_recall", { mode: "digest" })).toBe("")
    expect(memoryToolSubtitle("kilo_memory_save", { action: "remember", text: "bun test" })).toBe("bun test")
    expect(memoryToolSubtitle("kilo_memory_save", { action: "forget", query: "old" })).toBe("old")
    expect(memoryToolSubtitle("kilo_memory_save", { action: "remember", text: "lint_cmd :: bun run lint" })).toBe(
      "bun run lint",
    )
    expect(memoryToolSources({ sources: ["project.md", 1] })).toEqual(["project.md"])
  })

  it("lists the recalled memory texts instead of the model-facing records", () => {
    expect(memoryRecallItems(recall)).toEqual([
      "the test command is bun test",
      "moved CI to bun",
      "a note without a key",
    ])
    expect(memoryRecallItems(catalog)).toEqual(["run bun run lint", "refactor 2026-11-10"])
    expect(memoryRecallItems("No search memory matched the query.")).toEqual([])
    expect(memoryRecallCount({ count: 2 })).toBe(2)
    expect(memoryRecallCount({ title: "pending" })).toBeUndefined()
  })

  it("summarizes what a save did", () => {
    expect(memorySaveOutcome({ action: "remember" }, { added: 1, removed: 0 })).toEqual({ kind: "saved", count: 1 })
    expect(memorySaveOutcome({ action: "correct" }, { added: 1, removed: 0 })).toEqual({ kind: "corrected", count: 1 })
    expect(memorySaveOutcome({ action: "forget" }, { added: 0, removed: 3 })).toEqual({ kind: "removed", count: 3 })
    expect(memorySaveOutcome({ action: "forget" }, { added: 0, removed: 0 })).toEqual({ kind: "unchanged" })
    expect(memorySaveOutcome({ action: "remember" }, { added: 0, removed: 0 })).toEqual({ kind: "unchanged" })
    expect(memorySaveOutcome({ action: "skip" }, { added: 0, removed: 0, skippedCount: 1 })).toEqual({
      kind: "unchanged",
    })
    expect(memorySaveOutcome({ action: "remember" }, { sources: [] })).toBeUndefined()
    expect(memoryActionKey({ action: "forget" })).toBe("chat.memory.tool.action.forget")
    expect(memoryActionKey({ action: "other" })).toBeUndefined()
  })

  it("picks the CLDR plural form and falls back to other", () => {
    const table: Record<string, string> = {
      "n.one": "{{count}} one",
      "n.few": "{{count}} few",
      "n.many": "{{count}} many",
      "n.other": "{{count}} other",
    }
    const t = (key: string, params?: Record<string, string | number>) =>
      (table[key] ?? key).replace("{{count}}", String(params?.count ?? ""))
    expect(memoryPlural(t, "en", "n", 1)).toBe("1 one")
    expect(memoryPlural(t, "en", "n", 2)).toBe("2 other")
    expect(memoryPlural(t, "ru", "n", 3)).toBe("3 few")
    expect(memoryPlural(t, "ru", "n", 5)).toBe("5 many")
    expect(memoryPlural(t, "ar", "n", 0)).toBe("0 other")
  })

  it("shows what a permission request would save or search", () => {
    expect(memoryPermissionDetail("kilo_memory_save", { action: "remember", text: "use bun" })).toBe("use bun")
    expect(memoryPermissionDetail("kilo_memory_recall", { mode: "search", query: "test" })).toBe("test")
    expect(memoryPermissionDetail("kilo_memory_recall", { mode: "digest" })).toBeUndefined()
    expect(memoryPermissionDetail("shell", { text: "x" })).toBeUndefined()
  })
})

describe("memory translations", () => {
  const keys = (file: string, pattern: RegExp) =>
    new Set(Array.from(readFileSync(file, "utf8").matchAll(pattern), (match) => match[1]))
  const host = join(import.meta.dir, "../../kilo-i18n/src")
  const webview = join(import.meta.dir, "../webview-ui/src/i18n")
  const locales = [
    "ar",
    "br",
    "bs",
    "da",
    "de",
    "es",
    "fr",
    "it",
    "ja",
    "ko",
    "nl",
    "no",
    "pl",
    "ru",
    "th",
    "tr",
    "uk",
    "zh",
    "zht",
  ]
  const memory =
    /"((?:memory\.host|chat\.memory|settings\.context\.memory|ui\.permission\.toolLabel\.kilo_memory)[A-Za-z0-9_.]*)"\s*:/g

  // A plural key's categories differ per locale (CLDR), so parity compares the plural base, which needs `.other`.
  const base = (set: Set<string>) => new Set([...set].map((key) => key.replace(/\.(zero|one|two|few|many)$/, ".other")))

  it("every locale defines the memory keys of English", () => {
    const english = {
      host: base(keys(join(host, "en.ts"), memory)),
      webview: base(keys(join(webview, "en.ts"), memory)),
    }
    const missing = [
      ...locales.flatMap((locale) => {
        const found = keys(join(host, `${locale}.ts`), memory)
        return [...english.host].filter((key) => !found.has(key)).map((key) => `kilo-i18n/${locale}: ${key}`)
      }),
      ...[...locales, "fa"].flatMap((locale) => {
        const found = keys(join(webview, `${locale}.ts`), memory)
        // Every category a locale defines must belong to a plural key English has.
        const extra = [...found].filter(
          (key) => !english.webview.has(key.replace(/\.(zero|one|two|few|many)$/, ".other")),
        )
        if (extra.length) return extra.map((key) => `webview/${locale} extra: ${key}`)
        return [...english.webview].filter((key) => !found.has(key)).map((key) => `webview/${locale}: ${key}`)
      }),
    ]
    expect(english.host.size).toBeGreaterThan(20)
    expect(missing).toEqual([])
  })

  it("every locale gives the memory plural keys all CLDR categories it uses", () => {
    const plurals = ["chat.memory.tool.results", "chat.memory.tool.removed"]
    const tags: Record<string, string> = { br: "pt-BR", zht: "zh-TW", no: "nb" }
    const missing = [...locales, "fa"].flatMap((locale) => {
      const found = keys(join(webview, `${locale}.ts`), memory)
      const categories = new Intl.PluralRules(tags[locale] ?? locale).resolvedOptions().pluralCategories
      return plurals.flatMap((key) =>
        categories
          .filter((category) => !found.has(`${key}.${category}`))
          .map((category) => `${locale}: ${key}.${category}`),
      )
    })
    expect(missing).toEqual([])
  })

  it("translates the host copy with placeholders", () => {
    expect(memoryCopyFor("de").t("memory.host.show.shownOf", { shown: 2, total: 5 })).toBe("2 von 5 angezeigt")
    expect(memoryCopyFor("fa").t("memory.host.show.title")).toBe("Memory")
  })
})
