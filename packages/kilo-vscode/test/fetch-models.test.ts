// Fetch models for the custom provider dialog: the `GET {baseURL}/models` request against a local OpenAI-compatible
// server, the reply parsing and error kinds, and the host's choice of key and headers.
import { afterAll, describe, expect, test } from "bun:test"
import type { CredentialEntry } from "@opencode/client"
import { resolveHeaders, resolveKey, storedKeyFor } from "../src/custom-provider-models"
import { fetchOpenAIModels, FetchModelsError, modelsURL, parseModels, sameBaseURL } from "../src/shared/fetch-models"

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const auth = request.headers.get("authorization")
    if (url.pathname === "/v1/models") return Response.json({ data: [{ id: "b-model" }, { id: "a-model" }] })
    if (url.pathname === "/echo/models")
      return Response.json({
        data: [
          { id: `auth:${auth ?? ""}` },
          { id: `org:${request.headers.get("x-org") ?? ""}` },
          { id: `content-type:${request.headers.get("content-type") ?? ""}` },
        ],
      })
    if (url.pathname === "/auth/models")
      return auth === "Bearer sk-good"
        ? Response.json({ data: [{ id: "secret-model" }] })
        : new Response("invalid api key", { status: 401 })
    if (url.pathname === "/forbidden/models") return new Response("", { status: 403 })
    if (url.pathname === "/error/models") return new Response("x".repeat(500), { status: 500 })
    if (url.pathname === "/html/models") return new Response("<html></html>", { headers: { "content-type": "text/html" } })
    if (url.pathname === "/slow/models") {
      await Bun.sleep(300)
      return Response.json({ data: [{ id: "late" }] })
    }
    return new Response("not found", { status: 404 })
  },
})
const origin = `http://127.0.0.1:${server.port}`

afterAll(() => server.stop(true))

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(error).toBeInstanceOf(FetchModelsError)
  return error as FetchModelsError
}

describe("modelsURL", () => {
  test("joins /models to the base URL without a double slash", () => {
    expect(modelsURL("https://api.example.com/v1")).toBe("https://api.example.com/v1/models")
    expect(modelsURL("https://api.example.com/v1/")).toBe("https://api.example.com/v1/models")
    expect(modelsURL("  https://api.example.com/v1// ")).toBe("https://api.example.com/v1/models")
    expect(modelsURL("http://localhost:11434")).toBe("http://localhost:11434/models")
  })

  test("keeps a query string a query and drops the fragment", () => {
    expect(modelsURL("https://api.example.com/v1?api-version=2024-01")).toBe(
      "https://api.example.com/v1/models?api-version=2024-01",
    )
    expect(modelsURL("https://api.example.com/v1#frag")).toBe("https://api.example.com/v1/models")
    expect(modelsURL("https://api.example.com/v1/?x=1#f")).toBe("https://api.example.com/v1/models?x=1")
  })

  test("reports a base URL that is not a URL", async () => {
    const error = await failure(fetchOpenAIModels({ baseURL: "http://" }))
    expect(error.message).toBe("Invalid base URL")
  })

  test("compares base URLs without trailing slashes or spaces", () => {
    expect(sameBaseURL("https://example.com/v1", " https://example.com/v1/ ")).toBe(true)
    expect(sameBaseURL("https://example.com/v1", "https://example.com/v2")).toBe(false)
    expect(sameBaseURL("https://example.com/v1", "https://evil.example.net/v1")).toBe(false)
  })
})

describe("parseModels", () => {
  test("reads data, drops entries without an id, removes duplicates and sorts by id", () => {
    expect(
      parseModels({
        data: [
          { id: "b" },
          { id: " a ", name: " Alpha " },
          { id: "a", name: "Second" },
          { id: "" },
          { name: "no id" },
          { id: 7 },
          "junk",
          null,
          { id: "c", name: "  " },
        ],
      }),
    ).toEqual([
      { id: "a", name: "Alpha" },
      { id: "b", name: "b" },
      { id: "c", name: "c" },
    ])
  })

  test("returns no models for a reply without a data list", () => {
    expect(parseModels({ object: "list" })).toEqual([])
    expect(parseModels({ data: {} })).toEqual([])
    expect(parseModels([{ id: "a" }])).toEqual([])
    expect(parseModels(null)).toEqual([])
  })
})

describe("fetchOpenAIModels", () => {
  test("lists and sorts the models of the base URL", async () => {
    expect(await fetchOpenAIModels({ baseURL: `${origin}/v1/` })).toEqual([
      { id: "a-model", name: "a-model" },
      { id: "b-model", name: "b-model" },
    ])
  })

  test("sends the key as a bearer token and the custom headers", async () => {
    const models = await fetchOpenAIModels({ baseURL: `${origin}/echo`, apiKey: "sk-1", headers: { "X-Org": "acme" } })
    expect(models.map((model) => model.id)).toEqual(["auth:Bearer sk-1", "content-type:application/json", "org:acme"])
  })

  test("lets the key replace a custom Authorization header in any letter case", async () => {
    const replaced = await fetchOpenAIModels({
      baseURL: `${origin}/echo`,
      apiKey: "sk-1",
      headers: { authorization: "Basic old" },
    })
    expect(replaced[0]?.id).toBe("auth:Bearer sk-1")
    const kept = await fetchOpenAIModels({ baseURL: `${origin}/echo`, headers: { Authorization: "Basic custom" } })
    expect(kept[0]?.id).toBe("auth:Basic custom")
  })

  test("reports 401 and 403 as authentication errors", async () => {
    expect(await fetchOpenAIModels({ baseURL: `${origin}/auth`, apiKey: "sk-good" })).toEqual([
      { id: "secret-model", name: "secret-model" },
    ])
    const unauthorized = await failure(fetchOpenAIModels({ baseURL: `${origin}/auth`, apiKey: "sk-bad" }))
    expect(unauthorized.auth).toBe(true)
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.message).toBe("HTTP 401: invalid api key")
    const forbidden = await failure(fetchOpenAIModels({ baseURL: `${origin}/forbidden` }))
    expect(forbidden.auth).toBe(true)
    expect(forbidden.message).toBe("HTTP 403")
  })

  test("reports other HTTP errors with a short body and no auth flag", async () => {
    const error = await failure(fetchOpenAIModels({ baseURL: `${origin}/error` }))
    expect(error.auth).toBe(false)
    expect(error.message).toBe(`HTTP 500: ${"x".repeat(200)}`)
    expect((await failure(fetchOpenAIModels({ baseURL: `${origin}/missing` }))).message).toBe("HTTP 404: not found")
  })

  test("reports a reply that is not JSON", async () => {
    const error = await failure(fetchOpenAIModels({ baseURL: `${origin}/html` }))
    expect(error.message).toBe("The server did not return JSON")
    expect(error.auth).toBe(false)
  })

  test("stops waiting after the timeout", async () => {
    const error = await failure(fetchOpenAIModels({ baseURL: `${origin}/slow`, timeout: 100 }))
    expect(error.message).toBe("The server did not answer within 0.1 seconds")
    expect(error.auth).toBe(false)
  })

  test("reports a refused connection with its cause", async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response() })
    const url = `http://127.0.0.1:${closed.port}`
    closed.stop(true)
    const error = await failure(fetchOpenAIModels({ baseURL: url }))
    expect(error.auth).toBe(false)
    expect(error.message.length).toBeGreaterThan(0)
  })
})

describe("host key and headers", () => {
  const env = { MY_KEY: " sk-env ", TOKEN: "t-1" }
  const none = async () => undefined

  test("prefers a typed key, then an env variable, then the stored key", async () => {
    const stored = async (providerID: string) => `stored:${providerID}`
    expect(await resolveKey({ apiKey: " sk-typed ", env: "MY_KEY", providerID: "p" }, env, stored)).toBe("sk-typed")
    expect(await resolveKey({ env: "MY_KEY", providerID: "p" }, env, stored)).toBe("sk-env")
    expect(await resolveKey({ providerID: "p" }, env, stored)).toBe("stored:p")
    expect(await resolveKey({}, env, stored)).toBeUndefined()
  })

  test("sends no key for an unset or invalid env variable name", async () => {
    expect(await resolveKey({ env: "MISSING" }, env, none)).toBeUndefined()
    expect(await resolveKey({ env: "lower" }, { lower: "x" }, none)).toBeUndefined()
  })

  test("substitutes {env:NAME} in header values as the server does", () => {
    expect(resolveHeaders({ "X-Token": "Bearer {env:TOKEN}", "X-Missing": "{env:NOPE}", "X-Plain": "a" }, env)).toEqual({
      "X-Token": "Bearer t-1",
      "X-Missing": "",
      "X-Plain": "a",
    })
    expect(resolveHeaders(undefined, env)).toBeUndefined()
  })
})

describe("storedKeyFor", () => {
  const key = (id: string, integrationID: string, value: string, active: boolean): CredentialEntry =>
    ({ id, integrationID, label: "", active, value: { type: "key", key: value } }) as CredentialEntry
  const credentials = [
    key("cred_1", "myprovider", "sk-old", false),
    key("cred_2", "myprovider", "sk-active", true),
    key("cred_3", "myprovider", "sk-newest", false),
    key("cred_4", "other", "sk-other", true),
  ]
  const provider = { id: "myprovider", settings: { baseURL: "https://example.com/v1" } }

  test("returns the active key when the URL matches the saved base URL", () => {
    expect(storedKeyFor(provider, credentials, "https://example.com/v1")).toBe("sk-active")
    expect(storedKeyFor(provider, credentials, "https://example.com/v1/")).toBe("sk-active")
  })

  test("falls back to the newest key without an active one", () => {
    expect(storedKeyFor(provider, credentials.slice(0, 1).concat(credentials.slice(2)), "https://example.com/v1")).toBe(
      "sk-newest",
    )
  })

  test("refuses to send the stored key to another host or path", () => {
    expect(storedKeyFor(provider, credentials, "https://evil.example.net/v1")).toBeUndefined()
    expect(storedKeyFor(provider, credentials, "https://example.com/v2")).toBeUndefined()
    expect(storedKeyFor({ id: "myprovider" }, credentials, "https://example.com/v1")).toBeUndefined()
  })

  test("reads the credentials of the provider's integration and ignores other credential types", () => {
    expect(storedKeyFor({ ...provider, id: "unknown" }, credentials, "https://example.com/v1")).toBeUndefined()
    expect(storedKeyFor({ ...provider, id: "alias", integrationID: "other" }, credentials, "https://example.com/v1")).toBe(
      "sk-other",
    )
    const oauth = {
      id: "cred_5",
      integrationID: "myprovider",
      label: "",
      active: true,
      value: { type: "oauth", methodID: "m", refresh: "r", access: "a", expires: 0 },
    } as CredentialEntry
    expect(storedKeyFor(provider, [oauth], "https://example.com/v1")).toBeUndefined()
  })
})
