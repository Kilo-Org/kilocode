import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { handleAnacondaLink } from "@/kilocode/provider/anaconda-link"

let file: string

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anaconda-link-"))
  file = path.join(dir, "keyring")
  process.env.ANA_KEYRING_PATH = file
})

afterEach(() => {
  delete process.env.ANA_KEYRING_PATH
  fs.rmSync(path.dirname(file), { recursive: true, force: true })
  mock.restore()
})

// Write / read the keyring the same way anaconda-cli does.
const write = (key: string) => {
  const cred = { domain: "anaconda.com", api_key: key, repo_tokens: [], version: 2 }
  const encoded = Buffer.from(JSON.stringify(cred)).toString("base64")
  fs.writeFileSync(file, JSON.stringify({ "Anaconda Cloud": { "anaconda.com": encoded } }))
}

const read = () => {
  if (!fs.existsSync(file)) return undefined
  const encoded = JSON.parse(fs.readFileSync(file, "utf-8"))["Anaconda Cloud"]["anaconda.com"]
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf-8")).api_key as string
}

// Passport behaves as given; the link endpoint always hands back a new key.
// If an existing key were ever treated as missing, the keyring would be overwritten.
const route = (passport: () => Promise<Response>) =>
  spyOn(globalThis, "fetch").mockImplementation(((url: string) => {
    if (String(url).endsWith("/api/auth/passport")) return passport()
    return Promise.resolve(
      Response.json({ api_key: "ad-new-key", key: { id: "k", name: "n", user_id: "u", scopes: [], tags: [] } }),
    )
  }) as typeof fetch)

test("keeps an existing key when the passport fetch throws", async () => {
  write("ad-existing-key")
  const request = route(() => Promise.reject(new TypeError("fetch failed")))
  const failed = spyOn(Telemetry, "trackAnacondaLinkFailed")

  await handleAnacondaLink("kilo-token")

  expect(read()).toBe("ad-existing-key")
  expect(request.mock.calls.map((call) => String(call[0]))).toEqual(["https://anaconda.com/api/auth/passport"])
  expect(failed.mock.calls).toEqual([["passport"]])
})

test("keeps an existing key when the passport returns malformed JSON", async () => {
  write("ad-existing-key")
  route(() => Promise.resolve(new Response("not json")))

  await handleAnacondaLink("kilo-token")

  expect(read()).toBe("ad-existing-key")
})

test("links and saves a key when none exists", async () => {
  route(() => Promise.reject(new Error("passport should not be called")))
  const created = spyOn(Telemetry, "trackAnacondaLinkCreated")
  const failed = spyOn(Telemetry, "trackAnacondaLinkFailed")

  await handleAnacondaLink("kilo-token")

  expect(read()).toBe("ad-new-key")
  expect(created).toHaveBeenCalledTimes(1)
  expect(failed).not.toHaveBeenCalled()
})

test("tracks a link failure when the link endpoint errors", async () => {
  spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }))
  const created = spyOn(Telemetry, "trackAnacondaLinkCreated")
  const failed = spyOn(Telemetry, "trackAnacondaLinkFailed")

  await handleAnacondaLink("kilo-token")

  expect(read()).toBeUndefined()
  expect(created).not.toHaveBeenCalled()
  expect(failed.mock.calls).toEqual([["link"]])
})
