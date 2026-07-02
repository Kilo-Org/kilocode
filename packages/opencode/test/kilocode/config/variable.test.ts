import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test } from "bun:test"
import { ConfigVariable } from "@/config/variable"
import { InvalidError } from "@/config/error"

const source = { type: "virtual" as const, source: "test", dir: process.cwd() }

test("rejects server credential environment substitutions", async () => {
  await expect(
    ConfigVariable.substitute({
      ...source,
      text: "password={env:KILO_SERVER_PASSWORD}",
      env: { KILO_SERVER_PASSWORD: "secret" },
    }),
  ).rejects.toBeInstanceOf(InvalidError)
})

test("continues to substitute ordinary environment variables", async () => {
  const result = await ConfigVariable.substitute({
    ...source,
    text: "value={env:SAFE_VALUE}",
    env: { SAFE_VALUE: "allowed" },
  })
  expect(result).toBe("value=allowed")
})

test("reads ordinary file substitutions on every platform", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-config-variable-file-"))
  const file = path.join(dir, "value")
  await fs.writeFile(file, "allowed")
  try {
    expect(await ConfigVariable.substitute({ ...source, text: `{file:${file}}` })).toBe("allowed")
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test("rejects scoped file substitutions outside the allowed root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-config-variable-root-"))
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-config-variable-outside-"))
  const file = path.join(dir, "value")
  await fs.writeFile(file, "blocked")
  try {
    await expect(
      ConfigVariable.substitute({
        ...source,
        text: `{file:${file}}`,
        fileScope: { root, source: "test" },
      }),
    ).rejects.toBeInstanceOf(InvalidError)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test.skipIf(process.platform !== "linux")("does not substitute process environment files", async () => {
  await expect(
    ConfigVariable.substitute({
      ...source,
      text: "{file:/proc/self/environ}",
    }),
  ).rejects.toBeInstanceOf(InvalidError)
})

test.skipIf(process.platform !== "linux")("does not substitute an environment file through a symlink", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-config-variable-"))
  const link = path.join(dir, "value")
  await fs.symlink("/proc/self/environ", link)
  try {
    await expect(ConfigVariable.substitute({ ...source, text: `{file:${link}}` })).rejects.toBeInstanceOf(InvalidError)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
