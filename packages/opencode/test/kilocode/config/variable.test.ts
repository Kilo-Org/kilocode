import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test } from "bun:test"
import { ConfigVariable } from "@/config/variable"
import { ConfigVariableGuard } from "@/kilocode/config/variable"
import { InvalidError } from "@opencode-ai/core/v1/config/error"

const source = { type: "virtual" as const, source: "test", dir: process.cwd() }
const trusted = { ...source, trusted: true }

test("rejects file references in untrusted config without a fileScope", async () => {
  await expect(ConfigVariable.substitute({ ...source, text: "apiKey={file:/etc/passwd}" })).rejects.toBeInstanceOf(
    InvalidError,
  )
})

test("rejects untrusted file references that escape the scope root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-config-variable-root-"))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-config-variable-outside-"))
  const file = path.join(outside, "secret")
  await fs.writeFile(file, "top-secret")
  try {
    await expect(
      ConfigVariable.substitute({ ...source, text: `{file:${file}}`, fileScope: { root, source: "test" } }),
    ).rejects.toBeInstanceOf(InvalidError)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test("allows untrusted file references that stay inside the scope root", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kilo-config-variable-inside-")))
  const file = path.join(root, "value")
  await fs.writeFile(file, "allowed")
  try {
    expect(
      await ConfigVariable.substitute({
        ...source,
        dir: root,
        text: "{file:value}",
        fileScope: { root, source: path.join(root, "kilo.json") },
      }),
    ).toBe("allowed")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("allows untrusted absolute file references that resolve inside the scope root", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kilo-config-variable-abs-inside-")))
  const file = path.join(root, "value")
  await fs.writeFile(file, "allowed")
  try {
    // An absolute path is fine as long as it stays inside the root; only escapes are rejected.
    expect(
      await ConfigVariable.substitute({
        ...source,
        dir: root,
        text: `{file:${file}}`,
        fileScope: { root, source: path.join(root, "kilo.json") },
      }),
    ).toBe("allowed")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("rejects environment references in untrusted (project) config", async () => {
  await expect(
    ConfigVariable.substitute({ ...source, text: "value={env:SAFE_VALUE}", env: { SAFE_VALUE: "allowed" } }),
  ).rejects.toBeInstanceOf(InvalidError)
})

test("leaves untrusted text without references untouched", async () => {
  expect(await ConfigVariable.substitute({ ...source, text: "plain value" })).toBe("plain value")
})

test("ignores commented-out references in untrusted config", async () => {
  const text = ["// {file:/etc/passwd}", "// {env:SAFE_VALUE}"].join("\n")
  expect(await ConfigVariable.substitute({ ...source, text })).toBe(text)
})

test("rejects server credential environment substitutions", async () => {
  await expect(
    ConfigVariable.substitute({
      ...trusted,
      text: "password={env:KILO_SERVER_PASSWORD}",
      env: { KILO_SERVER_PASSWORD: "secret" },
    }),
  ).rejects.toBeInstanceOf(InvalidError)
})

test("continues to substitute ordinary environment variables when trusted", async () => {
  const result = await ConfigVariable.substitute({
    ...trusted,
    text: "value={env:SAFE_VALUE}",
    env: { SAFE_VALUE: "allowed" },
  })
  expect(result).toBe("value=allowed")
})

test("reads ordinary file substitutions on every platform when trusted", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-config-variable-file-"))
  const file = path.join(dir, "value")
  await fs.writeFile(file, "allowed")
  try {
    expect(await ConfigVariable.substitute({ ...trusted, text: `{file:${file}}` })).toBe("allowed")
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test.skipIf(process.platform !== "linux")("does not substitute process environment files", async () => {
  await expect(
    ConfigVariable.substitute({
      ...trusted,
      text: "{file:/proc/self/environ}",
    }),
  ).rejects.toBeInstanceOf(InvalidError)
})

test.skipIf(process.platform !== "linux")("does not substitute an environment file through a symlink", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-config-variable-"))
  const link = path.join(dir, "value")
  await fs.symlink("/proc/self/environ", link)
  try {
    await expect(ConfigVariable.substitute({ ...trusted, text: `{file:${link}}` })).rejects.toBeInstanceOf(InvalidError)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

// A deliberate scope block must surface even for callers that use missing:"empty" (e.g. agent prompts),
// rather than being silently emptied like a genuine missing/IO error.
test("scope-blocked file reference still rejects under missing:empty", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kilo-config-variable-empty-root-")))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-config-variable-empty-out-"))
  const file = path.join(outside, "secret")
  await fs.writeFile(file, "top-secret")
  try {
    await expect(
      ConfigVariable.substitute({
        ...source,
        dir: root,
        missing: "empty",
        text: `{file:${file}}`,
        fileScope: { root, source: path.join(root, "kilo.json") },
      }),
    ).rejects.toBeInstanceOf(InvalidError)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

// A genuine missing file under missing:"empty" is still emptied, not rejected.
test("missing (non-blocked) file reference is emptied under missing:empty", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kilo-config-variable-missing-")))
  try {
    const out = await ConfigVariable.substitute({
      ...source,
      dir: root,
      missing: "empty",
      text: "value={file:nope.txt}",
      fileScope: { root, source: path.join(root, "kilo.json") },
    })
    expect(out).toBe("value=")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

// The guard's BlockedError is classified by isBlocked (used to bypass missing:"empty").
test("guard read rejects an out-of-scope file with a BlockedError", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kilo-guard-root-")))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-guard-out-"))
  const file = path.join(outside, "secret")
  await fs.writeFile(file, "top-secret")
  try {
    const err = await ConfigVariableGuard.read(file, { root, source: "kilo.json", token: "{file:...}" }).then(
      () => undefined,
      (e) => e,
    )
    expect(err).toBeDefined()
    expect(ConfigVariableGuard.isBlocked(err)).toBe(true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})
