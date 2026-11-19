import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { createRoot } from "solid-js"
import { createCloudCatalog } from "../webview-ui/agent-manager/cloud/catalog"
import { createCloudNavigation, type CreateRoute } from "../webview-ui/agent-manager/cloud/route"

const form: CreateRoute = {
  kind: "create",
  directory: "/other",
  projectID: "other",
  repository: "https://github.com/example/other",
  scope: "team:other",
}
const target = {
  providerID: "kilo-cloud",
  scope: form.scope,
  workspaceID: "workspace",
  sessionID: "ses_same_as_local",
} as const

test("a late creation cannot navigate away from Local or cross the account or selected workspace", () => {
  const nav = createCloudNavigation()
  nav.select(form)
  nav.leave()
  expect(nav.created(form, target, "Task")).toBe(false)
  expect(nav.current()).toBeUndefined()
  const root: CreateRoute = { ...form, workspaceID: "another" }
  nav.select(root)
  expect(nav.created(root, target, "Task")).toBe(false)
  nav.select(form)
  expect(nav.created(form, { ...target, scope: "other account" }, "Task")).toBe(false)
  expect(nav.current()).toBe(form)
  expect(nav.created(form, target, "Task")).toBe(true)
  expect(nav.current()).toMatchObject({ kind: "session", directory: "/other", target })
  nav.invalidate("/unrelated")
  expect(nav.current()?.kind).toBe("session")
  nav.invalidate("/other")
  expect(nav.current()).toBeUndefined()
})

test("catalog pagination is passive, scoped to the row's directory, and deduplicates workspace IDs", async () => {
  const paths: string[] = []
  const inputs: unknown[] = []
  const workspace = (id: string) => ({ workspaceID: id, deletionState: "active", sessions: [] })
  const replies = [
    { state: "ready", scope: form.scope, repository: form.repository },
    { items: [workspace("one")], cursor: "page2" },
    { items: [workspace("one"), workspace("two")] },
  ]
  const api = OpenCode.make({
    baseUrl: "http://kilo.invalid",
    fetch: Object.assign(
      async (input: Request | URL | string, init?: RequestInit) => {
        const request = new Request(input, init)
        const url = new URL(request.url)
        paths.push(url.pathname)
        inputs.push(await request.json())
        expect(url.searchParams.get("location[directory]")).toBe(form.directory)
        return Response.json({ output: replies.shift() })
      },
      { preconnect: fetch.preconnect },
    ),
  })
  await createRoot(async (dispose) => {
    try {
      const data = createCloudCatalog(api, form.directory)
      await data.read()
      await data.read(data.cursor())
      expect(data.items().map((item) => item.workspaceID)).toEqual(["one", "two"])
      expect(paths).toEqual([
        "/api/rpc/kilocode.hosted/status",
        "/api/rpc/kilocode.hosted/list",
        "/api/rpc/kilocode.hosted/list",
      ])
      expect(inputs.at(-1)).toMatchObject({ input: { scope: form.scope, cursor: "page2" } })
    } finally {
      dispose()
    }
  })
})

test("restoration selects a verified catalog session and ignores the same session in a different scope", () => {
  const data = new Map<string, string>()
  const store = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, v: string) => {
      data.set(key, v)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
  const selected = { ...form, kind: "session" as const, target, title: "Task" }
  createCloudNavigation(store).select(selected)
  const nav = createCloudNavigation(store)
  expect(nav.restore([{ ...selected, scope: "other", target: { ...target, scope: "other" } }])).toBe(false)
  expect(nav.current()).toBeUndefined()
  expect(nav.restore([selected])).toBe(true)
  expect(nav.current()).toBe(selected)
  nav.leave()
  expect(createCloudNavigation(store).restore([selected])).toBe(false)
})

test("restart rebinds only the verified bookmark and closing returns to the recently viewed sibling", () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v)
    },
    removeItem: (k: string) => {
      values.delete(k)
    },
  }
  const root = { ...form, kind: "session" as const, target, title: "a", restoreKey: "payer-project" }
  createCloudNavigation(storage).select(root)
  const nav = createCloudNavigation(storage),
    next = { ...root, scope: "fresh", target: { ...target, scope: "fresh" } }
  expect(nav.restore([{ ...next, restoreKey: "different-account" }])).toBe(false)
  expect(nav.restore([next])).toBe(true)
  const b = { ...next, target: { ...next.target, sessionID: "b" } },
    c = { ...next, target: { ...next.target, sessionID: "c" } }
  nav.workspace([next, b, c])
  nav.select(b)
  nav.select(next)
  nav.close(next)
  expect(nav.current()).toBe(b)
})
