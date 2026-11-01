import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { linkAnacondaAccount, checkAnacondaLogin } from "../../src/auth/link-anaconda.js"
import { getApiKey, saveCredential } from "../../src/auth/anaconda-keyring.js"

let tmpdir: string
let keyringFile: string

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "link-test-"))
  keyringFile = path.join(tmpdir, "keyring")
  process.env.ANA_KEYRING_PATH = keyringFile
})

afterEach(() => {
  delete process.env.ANA_KEYRING_PATH
  fs.rmSync(tmpdir, { recursive: true, force: true })
  mock.restore()
})

describe("checkAnacondaLogin", () => {
  test("returns hasKey=false when no key exists", async () => {
    const result = await checkAnacondaLogin()
    expect(result).toEqual({ hasKey: false, email: null })
  })

  test("returns hasKey=true and email when key exists and passport succeeds", async () => {
    saveCredential({ apiKey: "ad-existing-key", domain: "anaconda.com" })

    spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        user_id: "u1",
        profile: { email: "user@anaconda.com" },
      }),
    )

    const result = await checkAnacondaLogin()
    expect(result).toEqual({ hasKey: true, email: "user@anaconda.com" })
  })

  test("calls passport with the keyring API key as Bearer token", async () => {
    saveCredential({ apiKey: "ad-my-key", domain: "anaconda.com" })

    const request = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ user_id: "u1", profile: { email: "user@example.com" } }),
    )

    await checkAnacondaLogin()

    const [url, opts] = request.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://anaconda.com/api/auth/passport")
    expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer ad-my-key")
  })

  test("returns hasKey=true with null email when passport returns HTTP error", async () => {
    saveCredential({ apiKey: "ad-existing-key", domain: "anaconda.com" })

    spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }))

    const result = await checkAnacondaLogin()
    expect(result).toEqual({ hasKey: true, email: null })
  })

  test("returns hasKey=true with null email when passport fetch throws", async () => {
    saveCredential({ apiKey: "ad-existing-key", domain: "anaconda.com" })

    spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"))

    const result = await checkAnacondaLogin()
    expect(result).toEqual({ hasKey: true, email: null })
  })

  test("returns hasKey=true with null email when passport returns malformed JSON", async () => {
    saveCredential({ apiKey: "ad-existing-key", domain: "anaconda.com" })

    spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 200 }))

    const result = await checkAnacondaLogin()
    expect(result).toEqual({ hasKey: true, email: null })
  })

  test("returns hasKey=true with null email when passport returns empty email", async () => {
    saveCredential({ apiKey: "ad-existing-key", domain: "anaconda.com" })

    spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ user_id: "u1", profile: { email: "" } }),
    )

    const result = await checkAnacondaLogin()
    expect(result).toEqual({ hasKey: true, email: null })
  })
})

describe("linkAnacondaAccount", () => {
  test("calls endpoint and saves API key on success", async () => {
    const response = {
      api_key: "ad-new-key-from-link",
      key: {
        id: "key-id-123",
        name: "Kilo API Key",
        user_id: "user-456",
        scopes: ["repo:read"],
        tags: ["kilo"],
      },
    }
    const request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(response))

    const result = await linkAnacondaAccount("kilo-token-abc")

    expect(result).toBe(true)
    expect(request).toHaveBeenCalledTimes(1)

    const [url, opts] = request.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://anaconda.com/api/auth/kilo/api-key")
    expect(opts.method).toBe("POST")
    expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer kilo-token-abc")

    expect(getApiKey("anaconda.com")).toBe("ad-new-key-from-link")
  })

  test("saves user_id from nested key object", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        api_key: "ad-key",
        key: { id: "k1", name: "Kilo API Key", user_id: "usr-789", scopes: [], tags: [] },
      }),
    )

    await linkAnacondaAccount("token")

    const raw = fs.readFileSync(keyringFile, "utf-8")
    const keyring = JSON.parse(raw)
    const decoded = JSON.parse(Buffer.from(keyring["Anaconda Cloud"]["anaconda.com"], "base64").toString("utf-8"))
    expect(decoded.user_id).toBe("usr-789")
  })

  test("returns false on HTTP error", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401, statusText: "Unauthorized" }))

    const result = await linkAnacondaAccount("bad-token")

    expect(result).toBe(false)
    expect(getApiKey("anaconda.com")).toBeUndefined()
  })

  test("returns false when response has no api_key", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ key: {} }))

    const result = await linkAnacondaAccount("token")

    expect(result).toBe(false)
    expect(getApiKey("anaconda.com")).toBeUndefined()
  })

  test("returns false on network error", async () => {
    spyOn(globalThis, "fetch").mockRejectedValue(new Error("network offline"))

    const result = await linkAnacondaAccount("token").catch(() => false)

    expect(result).toBe(false)
  })
})
