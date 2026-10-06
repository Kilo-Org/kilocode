import { expect, test } from "bun:test"
import path from "node:path"
import { upload } from "./release"

const NAMES = [
  "kilo-linux-x64-musl.tar.gz",
  "kilo-linux-x64.tar.gz",
  "kilo-darwin-arm64.zip",
  "kilo-windows-x64.zip",
  "kilo-cli-SHA256SUMS",
  "cli-sbom-evidence.json",
]
const FILES = NAMES.map((name) => path.join("/tmp/dist", name))

/** The exact payload the v7.8.6 publish run died on (run 37520899871). */
const EXISTS = [
  "HTTP 422: Validation Failed (https://uploads.github.com/repos/Kilo-Org/kilocode/releases/405082514/assets?label=&name=kilo-linux-x64-musl.tar.gz)",
  "ReleaseAsset.name already exists",
].join("\n")

test("a dropped connection that still created the asset recovers on the next attempt", async () => {
  const assets = new Map<string, string>()
  const attempts = new Map<string, number>()

  await upload({
    tag: "v7.8.6",
    files: FILES,
    delay: 0,
    push: async (file) => {
      const name = path.basename(file)
      const count = (attempts.get(name) ?? 0) + 1
      attempts.set(name, count)
      // --clobber removes whatever is already there, and GitHub commits the asset
      // before the connection drops, which is what makes the retry collide.
      assets.delete(name)
      assets.set(name, "uploaded")
      if (name === NAMES[0] && count === 1) return { ok: false, message: EXISTS }
      return { ok: true, message: "" }
    },
    list: async () => [...assets].map(([name, state]) => ({ name, state })),
  })

  expect(attempts.get(NAMES[0]!)).toBe(2)
  expect([...assets.keys()].sort()).toEqual([...NAMES].sort())
})

test("a permanently failing asset is reported without cancelling the rest", async () => {
  const assets = new Map<string, string>()

  const result = upload({
    tag: "v7.8.6",
    files: FILES,
    delay: 0,
    attempts: 2,
    push: async (file) => {
      const name = path.basename(file)
      if (name === NAMES[1]) return { ok: false, message: "HTTP 500: Internal Server Error" }
      assets.set(name, "uploaded")
      return { ok: true, message: "" }
    },
    list: async () => [...assets].map(([name, state]) => ({ name, state })),
  })

  await expect(result).rejects.toThrow(
    "release v7.8.6: 1 asset(s) failed\nkilo-linux-x64.tar.gz: HTTP 500: Internal Server Error",
  )
  expect([...assets.keys()].sort()).toEqual(NAMES.filter((name) => name !== NAMES[1]).sort())
})

test("an asset that never landed fails the upload even though gh reported success", async () => {
  const result = upload({
    tag: "v7.8.6",
    files: FILES,
    delay: 0,
    push: async () => ({ ok: true, message: "" }),
    list: async () =>
      NAMES.filter((name) => name !== NAMES[3]).map((name) => ({
        name,
        state: name === NAMES[2] ? "starter" : "uploaded",
      })),
  })

  await expect(result).rejects.toThrow(/2 asset\(s\) failed/)
  await expect(result).rejects.toThrow(/kilo-darwin-arm64\.zip: not published \(state=starter\)/)
  await expect(result).rejects.toThrow(/kilo-windows-x64\.zip: not published \(state=absent\)/)
})

test("uploads run in parallel but never exceed the configured concurrency", async () => {
  const live = { now: 0, peak: 0 }

  await upload({
    tag: "v7.8.6",
    files: FILES,
    delay: 0,
    concurrency: 2,
    push: async () => {
      live.now++
      live.peak = Math.max(live.peak, live.now)
      await Bun.sleep(5)
      live.now--
      return { ok: true, message: "" }
    },
    list: async () => NAMES.map((name) => ({ name, state: "uploaded" })),
  })

  expect(live.peak).toBe(2)
})

test("an unreadable asset listing does not fail uploads gh already confirmed", async () => {
  await upload({
    tag: "v7.8.6",
    files: FILES,
    delay: 0,
    push: async () => ({ ok: true, message: "" }),
    list: async () => {
      throw new Error("HTTP 403: API rate limit exceeded")
    },
  })
})

test("an empty file set never shells out", async () => {
  await upload({
    tag: "v7.8.6",
    files: [],
    push: async () => {
      throw new Error("gh must not run")
    },
    list: async () => {
      throw new Error("gh must not run")
    },
  })
})
