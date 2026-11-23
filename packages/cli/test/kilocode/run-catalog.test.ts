import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client/promise"
import { waitForRunCatalog } from "../../src/kilocode/run-catalog"

const target = { providerID: "kilo", id: "openai/example" }
const directory = "/project/test"
const signal = new AbortController().signal

function catalog(respond: (request: Request) => Promise<Response> | Response) {
  const request = async (url: RequestInfo | URL, init?: RequestInit) => respond(new Request(url, init))
  return OpenCode.make({ baseUrl: "http://localhost", fetch: Object.assign(request, { preconnect: fetch.preconnect }) })
}

test("a partial catalog with the same ID under a different provider does not admit the run", async () => {
  const snapshots = [[{ ...target, providerID: "other" }], [target]]
  const client = catalog((request) => {
    expect(request.method).toBe("GET")
    expect(new URL(request.url).searchParams.get("location[directory]")).toBe(directory)
    return Response.json({ data: snapshots.shift() })
  })
  await waitForRunCatalog(client, directory, target, signal)
  expect(snapshots).toHaveLength(0)
})

test("uses the location default when the session has no explicit model", async () => {
  const paths: string[] = []
  const client = catalog((request) => {
    paths.push(new URL(request.url).pathname)
    return Response.json({ data: paths.length > 1 ? target : null })
  })
  await waitForRunCatalog(client, directory, undefined, signal)
  expect(paths).toEqual(["/api/model/default", "/api/model/default"])
})

test("a warm catalog only needs one read", async () => {
  let reads = 0
  const client = catalog(() => {
    reads++
    return Response.json({ data: [target] })
  })
  await waitForRunCatalog(client, directory, target, signal)
  expect(reads).toBe(1)
})

test("a stalled catalog read respects the deadline and caller cancellation", async () => {
  const client = catalog(
    (request) =>
      new Promise<Response>((_, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true })
      }),
  )
  await expect(waitForRunCatalog(client, directory, target, signal, 10)).rejects.toThrow("No prompt was sent")
  const cancel = new AbortController()
  const waiting = waitForRunCatalog(client, directory, target, cancel.signal)
  cancel.abort(new Error("run interrupted"))
  await expect(waiting).rejects.toThrow("run interrupted")
})

test("a settled catalog without the session model falls back to the default model", async () => {
  let reads = 0
  const fallback = { providerID: "kilo", id: "default-model" }
  const client = catalog((request) => {
    const url = new URL(request.url)
    if (url.pathname === "/api/model/default") return Response.json({ data: fallback })
    reads++
    return Response.json({ data: [{ providerID: "kilo", id: "other-model" }] })
  })
  await expect(
    waitForRunCatalog(client, directory, target, signal, 5_000, "default", { fallbackToDefault: true }),
  ).resolves.toEqual({ model: fallback, fallbackFrom: target })
  expect(reads).toBe(3)
})

test("a missing session model falls back at the deadline even when its provider has not published", async () => {
  const fallback = { providerID: "kilo", id: "default-model" }
  const client = catalog((request) => {
    const url = new URL(request.url)
    if (url.pathname === "/api/model/default") return Response.json({ data: fallback })
    return Response.json({ data: [] })
  })
  await expect(
    waitForRunCatalog(client, directory, target, signal, 10, "default", { fallbackToDefault: true }),
  ).resolves.toEqual({ model: fallback, fallbackFrom: target })
})

test("fallback does not hide a missing default model", async () => {
  const client = catalog((request) => {
    const url = new URL(request.url)
    if (url.pathname === "/api/model/default") return Response.json({ data: null })
    return Response.json({ data: [] })
  })
  await expect(
    waitForRunCatalog(client, directory, target, signal, 10, "default", { fallbackToDefault: true }),
  ).rejects.toThrow("No prompt was sent")
})
