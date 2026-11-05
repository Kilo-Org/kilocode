import { expect, spyOn, test } from "bun:test"
import { Effect } from "effect"
import { parse } from "jsonc-parser"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Flock } from "@opencode/util/flock"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { settings } from "../src/session-sync/settings"

const directory = async (body: (root: string) => Promise<void>) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-sync-settings-"))
  try {
    await body(root)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

const open = fs.open
const rename = fs.rename

for (const name of KiloConfigFiles.names) {
  test.each(["", " \n\t", "// global configuration", "/* global configuration */", "// first\n/* second */\n"])(
    `${name} defaults on and remains writable with empty or comments-only content %j`,
    async (text) => directory(async (root) => {
      const file = path.join(root, name)
      await fs.writeFile(file, text)
      const config = settings(root)
      expect(await Effect.runPromise(config.enabled)).toBe(true)
      await Effect.runPromise(config.set(false))
      expect(await Effect.runPromise(config.enabled)).toBe(false)
      const updated = await fs.readFile(file, "utf8")
      expect(parse(updated)).toEqual({ session_sync: false })
      if (text.trim()) expect(updated).toContain(text.trim())
      await Effect.runPromise(config.set(true))
      expect(await Effect.runPromise(config.enabled)).toBe(true)
      expect((await fs.readdir(root)).sort()).toEqual([".locks", name])
    }),
  )
}

test("missing settings default on and can create the global directory", async () => directory(async (root) => {
  const global = path.join(root, "new", "global")
  const config = settings(global)
  expect(await Effect.runPromise(config.enabled)).toBe(true)
  await Effect.runPromise(config.set(false))
  expect(await Effect.runPromise(config.enabled)).toBe(false)
  expect(parse(await fs.readFile(path.join(global, KiloConfigFiles.names.at(-1)!), "utf8"))).toEqual({ session_sync: false })
}))

test.each([
  "null", "[]", "true", "1", '"config"',
  '{"session_sync": null}', '{"session_sync": "true"}', '{"session_sync": 1}',
  '{"session_sync": []}', '{"session_sync": {}}', '{"session_sync":', "/* unterminated",
])("invalid roots, types and syntax are not overwritten: %s", async (text) => directory(async (root) => {
  const file = path.join(root, "kilo2.jsonc")
  await fs.writeFile(file, text)
  const config = settings(root)
  expect((await Effect.runPromise(Effect.flip(config.enabled))).code).toBe("settings_unavailable")
  expect((await Effect.runPromise(Effect.flip(config.set(false)))).code).toBe("settings_unavailable")
  expect(await fs.readFile(file, "utf8")).toBe(text)
  expect((await fs.readdir(root)).sort()).toEqual([".locks", "kilo2.jsonc"])
}))

test("only the winning global setting changes; unrelated JSONC comments and fields survive", async () => directory(async (root) => {
  const lower = path.join(root, "kilo2.json")
  const winning = path.join(root, "kilo2.jsonc")
  const lowerText = '{ "session_sync": true, "shell": "bash" }\n'
  const text = '// global settings\n{\n  // keep this shell\n  "shell": "zsh",\n  "session_sync": true, // keep this comment\n  "plugins": ["example"],\n}\n// footer\n'
  await fs.writeFile(lower, lowerText)
  await fs.writeFile(winning, text)
  await Effect.runPromise(settings(root).set(false))
  expect(await fs.readFile(lower, "utf8")).toBe(lowerText)
  expect(await fs.readFile(winning, "utf8")).toBe(text.replace('"session_sync": true', '"session_sync": false'))
  expect(await Effect.runPromise(settings(root).enabled)).toBe(false)
}))

test("an empty higher-precedence document leaves the lower setting in force", async () => directory(async (root) => {
  await fs.writeFile(path.join(root, "kilo2.json"), '{"session_sync": false}\n')
  await fs.writeFile(path.join(root, "kilo2.jsonc"), "// no override\n")
  expect(await Effect.runPromise(settings(root).enabled)).toBe(false)
  await Effect.runPromise(settings(root).set(true))
  expect(await Effect.runPromise(settings(root).enabled)).toBe(true)
  expect(await fs.readFile(path.join(root, "kilo2.json"), "utf8")).toBe('{"session_sync": false}\n')
  expect(await fs.readFile(path.join(root, "kilo2.jsonc"), "utf8")).toContain("// no override")
}))

test("a write atomically replaces the config without exposing partially written content", async () => directory(async (root) => {
  const file = path.join(root, "kilo2.jsonc")
  const text = '{"session_sync": true, "shell": "zsh"}\n'
  await fs.writeFile(file, text)
  const reader = await open(file, "r")
  const blocked = Promise.withResolvers<void>()
  const replacing = spyOn(fs, "rename").mockImplementation(async (...args) => {
    try {
      return await rename(...args)
    } catch (error) {
      blocked.resolve()
      throw error
    }
  })
  let closed = false
  const changed = Effect.runPromise(settings(root).set(false))
  try {
    if (process.platform === "win32") {
      // A Windows reader can deny replacement. Release it after observing the first attempt,
      // allowing the bounded retry to finish; either complete version is valid for a reader.
      await Promise.race([blocked.promise, changed])
      expect([text, text.replace("true", "false")]).toContain(await reader.readFile("utf8"))
      await reader.close()
      closed = true
      await changed
    } else {
      await changed
      expect(await reader.readFile("utf8")).toBe(text)
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    }
    expect(parse(await fs.readFile(file, "utf8"))).toEqual({ session_sync: false, shell: "zsh" })
    expect((await fs.readdir(root)).sort()).toEqual([".locks", "kilo2.jsonc"])
  } finally {
    if (!closed) await reader.close()
    await changed.catch(() => undefined)
    replacing.mockRestore()
  }
}))

for (const code of ["EPERM", "EBUSY", "EACCES"]) {
  test(`temporary ${code} replacement failures retry without truncating the config`, async () => directory(async (root) => {
    const file = path.join(root, "kilo2.jsonc")
    const text = '{"session_sync": true, "shell": "zsh"}\n'
    await fs.writeFile(file, text)
    let attempts = 0
    const replacing = spyOn(fs, "rename").mockImplementation(async (...args) => {
      attempts++
      expect(await fs.readFile(file, "utf8")).toBe(text)
      if (attempts < 4) throw Object.assign(new Error("Fixture sharing violation"), { code })
      return rename(...args)
    })
    try {
      await Effect.runPromise(settings(root).set(false))
    } finally {
      replacing.mockRestore()
    }
    expect(attempts).toBe(4)
    expect(parse(await fs.readFile(file, "utf8"))).toEqual({ session_sync: false, shell: "zsh" })
    expect((await fs.readdir(root)).sort()).toEqual([".locks", "kilo2.jsonc"])
  }))

  test(`persistent ${code} replacement failures are bounded and retryable`, async () => directory(async (root) => {
    const file = path.join(root, "kilo2.jsonc")
    const text = '{"session_sync": true, "shell": "zsh"}\n'
    await fs.writeFile(file, text)
    let attempts = 0
    const replacing = spyOn(fs, "rename").mockImplementation(async () => {
      attempts++
      throw Object.assign(new Error("Fixture sharing violation"), { code })
    })
    try {
      expect(await Effect.runPromise(Effect.flip(settings(root).set(false)))).toMatchObject({
        code: "settings_unavailable",
        retryable: true,
      })
    } finally {
      replacing.mockRestore()
    }
    expect(attempts).toBe(8)
    expect(await fs.readFile(file, "utf8")).toBe(text)
    expect((await fs.readdir(root)).sort()).toEqual([".locks", "kilo2.jsonc"])
  }))
}

test("concurrent settings instances serialize their actual filesystem writes", async () => directory(async (root) => {
  const file = path.join(root, "kilo2.jsonc")
  const text = '{"session_sync": true, "shell": "zsh"}\n'
  await fs.writeFile(file, text)
  const opened = Promise.withResolvers<void>()
  const resume = Promise.withResolvers<void>()
  const waiting = Promise.withResolvers<void>()
  let writes = 0
  const opening = spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args)
    if (args[1] === "wx" && String(args[0]).startsWith(`${file}.`)) {
      writes++
      if (writes === 1) {
        opened.resolve()
        await resume.promise
      }
    }
    return handle
  })
  const acquire = Flock.acquire
  const locking = spyOn(Flock, "acquire").mockImplementation((key, options) => acquire(key, {
    ...options,
    onWait: async (event) => {
      waiting.resolve()
      await options?.onWait?.(event)
    },
  }))
  const pending: Promise<void>[] = []
  try {
    const first = Effect.runPromise(settings(root).set(false))
    pending.push(first)
    await Promise.race([opened.promise, first.then(() => { throw new Error("First writer did not open a temporary file") })])
    const second = Effect.runPromise(settings(root).set(true))
    pending.push(second)
    await Promise.race([waiting.promise, second.then(() => { throw new Error("Concurrent writer bypassed the settings lock") })])
    expect(writes).toBe(1)
    expect(await fs.readFile(file, "utf8")).toBe(text)
    resume.resolve()
    await Promise.all(pending)
    expect(writes).toBe(2)
    expect(parse(await fs.readFile(file, "utf8"))).toEqual({ session_sync: true, shell: "zsh" })
    expect((await fs.readdir(root)).sort()).toEqual([".locks", "kilo2.jsonc"])
  } finally {
    resume.resolve()
    await Promise.allSettled(pending)
    locking.mockRestore()
    opening.mockRestore()
  }
}))

for (const change of ["in-place edit", "atomic replacement", "same-text replacement", "higher-precedence creation"] as const) {
  test(`revision conflicts rebase a non-cooperating ${change}`, async () => directory(async (root) => {
    const file = path.join(root, "kilo2.json")
    const higher = path.join(root, "kilo2.jsonc")
    const text = '{"session_sync": true, "shell": "zsh"}\n'
    const external = '// plugin add\n{"session_sync": true, "shell": "zsh", "plugins": ["added"]}\n'
    await fs.writeFile(file, text)
    let writes = 0
    const opening = spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args)
      if (args[1] === "wx") {
        writes++
        if (writes === 1) {
          if (change === "higher-precedence creation") await fs.writeFile(higher, external)
          else if (change === "in-place edit") await fs.writeFile(file, external)
          else {
            const replacement = path.join(root, "replacement")
            await fs.writeFile(replacement, change === "same-text replacement" ? text : external)
            await fs.rename(replacement, file)
          }
        }
      }
      return handle
    })
    try {
      await Effect.runPromise(settings(root).set(false))
    } finally {
      opening.mockRestore()
    }
    expect(writes).toBe(2)
    const target = change === "higher-precedence creation" ? higher : file
    expect(parse(await fs.readFile(target, "utf8"))).toEqual({
      session_sync: false,
      shell: "zsh",
      ...(change === "same-text replacement" ? {} : { plugins: ["added"] }),
    })
    if (change !== "same-text replacement") expect(await fs.readFile(target, "utf8")).toContain("// plugin add")
    if (change === "higher-precedence creation") expect(await fs.readFile(file, "utf8")).toBe(text)
    expect((await fs.readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([])
  }))
}

test("continued revision conflicts fail without overwriting external edits or leaving temporary files", async () => directory(async (root) => {
  const file = path.join(root, "kilo2.jsonc")
  await fs.writeFile(file, '{"session_sync": true}\n')
  let writes = 0
  const opening = spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args)
    if (args[1] === "wx") {
      writes++
      await fs.writeFile(file, JSON.stringify({ session_sync: true, external: writes }))
    }
    return handle
  })
  try {
    expect((await Effect.runPromise(Effect.flip(settings(root).set(false)))).code).toBe("settings_unavailable")
  } finally {
    opening.mockRestore()
  }
  expect(writes).toBe(8)
  expect(parse(await fs.readFile(file, "utf8"))).toEqual({ session_sync: true, external: writes })
  expect((await fs.readdir(root)).sort()).toEqual([".locks", "kilo2.jsonc"])
}))
