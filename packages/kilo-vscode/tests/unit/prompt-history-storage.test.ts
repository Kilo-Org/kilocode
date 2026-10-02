import { describe, it, expect, beforeEach } from "bun:test"
import { createRoot, createSignal } from "solid-js"

type Mod = typeof import("../../webview-ui/src/hooks/usePromptHistory")
const KEY = "kilo.prompt-history.v2"
const LEGACY = "kilo.prompt-history.v1"

let data: Map<string, string>
let quota = Infinity
let n = 0

beforeEach(() => {
  data = new Map()
  quota = Infinity
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (v.length > quota) throw new Error("QuotaExceededError")
        data.set(k, v)
      },
    },
  })
})

// A fresh module instance reloads the store from the stub, like a webview reload.
const load = (): Promise<Mod> => import(`../../webview-ui/src/hooks/usePromptHistory?case=${n++}`)

const use = (mod: Mod, key: string | undefined, shared = false) => {
  const [sid] = createSignal(key)
  return mod.usePromptHistory(sid, () => shared)
}

describe("prompt history storage", () => {
  it("restores each conversation after a reload", async () => {
    await createRoot(async (dispose) => {
      const first = await load()
      use(first, "ses-a").append("from a")
      use(first, "ses-b").append("from b")

      const second = await load()
      expect(use(second, "ses-a").navigate("up", "", 0, [])?.text).toBe("from a")
      expect(use(second, "ses-b").navigate("up", "", 0, [])?.text).toBe("from b")
      dispose()
    })
  })

  it("ignores corrupt or wrongly shaped storage", async () => {
    for (const raw of ["not json", "[1,2]", '{"ses":"text"}', '{"ses":[1,null]}']) {
      data.set(KEY, raw)
      const mod = await load()
      expect(use(mod, "ses").navigate("up", "", 0, [])).toBeNull()
    }
  })

  it("keeps the shared list in the original v1 key, written as a flat array", async () => {
    data.set(LEGACY, JSON.stringify(["newest", "oldest"]))
    const mod = await load()
    const history = use(mod, "ses-x", true)
    expect(history.navigate("up", "", 0, [])?.text).toBe("newest")
    history.append("latest")
    expect(JSON.parse(data.get(LEGACY) ?? "[]")).toEqual(["latest", "newest", "oldest"])
    expect(data.has(KEY)).toBe(false)
    expect(use(mod, "ses-x").navigate("up", "", 0, [])).toBeNull()
  })

  it("seeds the shared list from session messages, like prompts sent in the TUI", async () => {
    const mod = await load()
    const history = use(mod, "ses-tui", true)
    history.seed(["first", "second", "third"])
    expect(history.navigate("up", "", 0, [])?.text).toBe("third")
    expect(history.navigate("up", "", 0, [])?.text).toBe("second")
    expect(JSON.parse(data.get(LEGACY) ?? "[]")).toEqual(["third", "second", "first"])
  })

  it("remembers long prompts in the shared list, as before", async () => {
    const mod = await load()
    const long = "x".repeat(mod.MAX_ENTRY * 3)
    use(mod, "ses-x", true).append(long)
    use(mod, "ses-x", true).seed([long + "!"])

    const again = await load()
    const history = use(again, "ses-x", true)
    expect(history.navigate("up", "", 0, [])?.text).toBe(long)
    expect(history.navigate("up", "", 0, [])?.text).toBe(long + "!")
  })

  it("does not rewrite the shared list when a conversation list changes", async () => {
    data.set(LEGACY, JSON.stringify(["shared"]))
    const mod = await load()
    use(mod, "ses-a").append("scoped")
    data.set(LEGACY, JSON.stringify(["changed by another window"]))
    use(mod, "ses-a").append("scoped again")
    expect(JSON.parse(data.get(LEGACY) ?? "[]")).toEqual(["changed by another window"])
    expect(JSON.parse(data.get(KEY) ?? "{}")["ses-a"]).toEqual(["scoped again", "scoped"])
  })

  it("persists the cap on conversations and keeps the global list", async () => {
    const mod = await load()
    use(mod, "ses-x", true).append("keep global")
    for (let i = 0; i < mod.MAX_CONVERSATIONS + 10; i++) use(mod, `ses-${i}`).append(`m${i}`)

    const saved = JSON.parse(data.get(KEY) ?? "{}") as Record<string, string[]>
    expect(Object.keys(saved).length).toBeLessThanOrEqual(mod.MAX_CONVERSATIONS)
    expect(saved.global).toBeUndefined()
    expect(JSON.parse(data.get(LEGACY) ?? "[]")).toEqual(["keep global"])
    expect(saved["ses-0"]).toBeUndefined()
    expect(saved[`ses-${mod.MAX_CONVERSATIONS + 9}`]).toEqual([`m${mod.MAX_CONVERSATIONS + 9}`])
  })

  it("sheds the oldest conversations when the storage quota is exceeded", async () => {
    const mod = await load()
    for (let i = 0; i < 5; i++) use(mod, `old-${i}`).append("x".repeat(1000))
    quota = 3500
    use(mod, "fresh").append("latest")

    const saved = JSON.parse(data.get(KEY) ?? "{}") as Record<string, string[]>
    expect(saved.fresh).toEqual(["latest"])
    expect(saved["old-0"]).toBeUndefined()
    expect(Object.keys(saved).length).toBeLessThan(6)
  })

  it("does not write anything for a read", async () => {
    const mod = await load()
    use(mod, "ses-read").navigate("up", "", 0, [])
    expect(data.has(KEY)).toBe(false)
  })
})
