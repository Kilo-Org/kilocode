import { beforeEach, describe, expect, mock, test } from "bun:test"
import { vertexAuthFetch } from "@/kilocode/provider/provider"

const authOptions: Record<string, any>[] = []

void mock.module("google-auth-library", () => ({
  GoogleAuth: class {
    constructor(options: Record<string, any>) {
      authOptions.push(options)
    }

    async getClient() {
      return {
        async getAccessToken() {
          return { token: "vertex-token" }
        },
      }
    }
  },
}))

const SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]

function stubFetch() {
  const calls: { input: RequestInfo | URL; init: RequestInit | undefined }[] = []
  const original = globalThis.fetch
  // Bun's `fetch` type carries its own `preconnect`, so the stub must too.
  const stub = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response("ok")
    },
    { preconnect: original.preconnect },
  )
  globalThis.fetch = stub
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

describe("vertexAuthFetch", () => {
  beforeEach(() => {
    authOptions.length = 0
  })

  test("attaches the access token to a Vertex API host", async () => {
    const stub = stubFetch()
    try {
      const url =
        "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/models/x:streamRawPredict"
      const response = await vertexAuthFetch(undefined)(url, { headers: { "x-test": "keep" } })

      expect(response.status).toBe(200)
      expect(stub.calls).toHaveLength(1)
      expect(stub.calls[0].input).toBe(url)
      const headers = new Headers(stub.calls[0].init?.headers)
      expect(headers.get("authorization")).toBe("Bearer vertex-token")
      expect(headers.get("x-test")).toBe("keep")
      expect(authOptions).toEqual([{ scopes: SCOPES }])
    } finally {
      stub.restore()
    }
  })

  test("attaches the access token to the regional rep host", async () => {
    const stub = stubFetch()
    const credentials = { client_email: "service@example.iam.gserviceaccount.com", private_key: "private-key" }
    try {
      await vertexAuthFetch(credentials)("https://aiplatform.eu.rep.googleapis.com/v1/projects/p/locations/eu/models/x")

      expect(stub.calls).toHaveLength(1)
      expect(new Headers(stub.calls[0].init?.headers).get("authorization")).toBe("Bearer vertex-token")
      expect(authOptions).toEqual([{ scopes: SCOPES, credentials }])
    } finally {
      stub.restore()
    }
  })

  test("forwards an explicit other host unchanged", async () => {
    const stub = stubFetch()
    const url = "https://proxy.example/v1/chat/completions"
    const init: RequestInit = { headers: { "x-test": "keep" } }
    try {
      await vertexAuthFetch(undefined)(url, init)

      expect(stub.calls).toHaveLength(1)
      expect(stub.calls[0]).toEqual({ input: url, init })
      expect(new Headers(stub.calls[0].init?.headers).get("authorization")).toBeNull()
      expect(authOptions).toHaveLength(0)
    } finally {
      stub.restore()
    }
  })

  test("forwards an input whose host cannot be parsed unchanged", async () => {
    const stub = stubFetch()
    const input = "not a url"
    try {
      await vertexAuthFetch(undefined)(input)

      expect(stub.calls).toHaveLength(1)
      expect(stub.calls[0].input).toBe(input)
      expect(stub.calls[0].init).toBeUndefined()
      expect(authOptions).toHaveLength(0)
    } finally {
      stub.restore()
    }
  })
})
