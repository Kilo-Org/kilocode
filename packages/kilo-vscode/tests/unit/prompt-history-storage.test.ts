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

  it("starts the global list from the pre-v2 shared list", async () => {
    data.set(LEGACY, JSON.stringify(["newest", "oldest"]))
    const mod = await load()
    const history = use(mod, "ses-x", true)
    expect(history.navigate("up", "", 0, [])?.text).toBe("newest")
    expect(history.navigate("up", "", 0, [])?.text).toBe("oldest")
    expect(use(mod, "ses-x").navigate("up", "", 0, [])).toBeNull()
  })

  it("prefers an existing v2 global list over the legacy one", async () => {
    data.set(LEGACY, JSON.stringify(["legacy"]))
    data.set(KEY, JSON.stringify({ global: ["current"] }))
    const mod = await load()
    expect(use(mod, "ses-x", true).navigate("up", "", 0, [])?.text).toBe("current")
  })

  it("persists the cap on conversations and keeps the global list", async () => {
    const mod = await load()
    use(mod, "ses-x", true).append("keep global")
    for (let i = 0; i < mod.MAX_CONVERSATIONS + 10; i++) use(mod, `ses-${i}`).append(`m${i}`)

    const saved = JSON.parse(data.get(KEY) ?? "{}") as Record<string, string[]>
    expect(Object.keys(saved).length).toBeLessThanOrEqual(mod.MAX_CONVERSATIONS)
    expect(saved.global).toEqual(["keep global"])
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
