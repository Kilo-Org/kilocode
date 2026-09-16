import { describe, expect, test } from "bun:test"
import { watch } from "node:fs"
import fs from "fs/promises"
import path from "path"
import { TsCheck } from "../../src/kilocode/ts-check"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

async function checker(root: string, input: { code?: number; stdout?: string; stderr?: string; wait?: boolean } = {}) {
  const script = path.join(root, "node_modules", "typescript", "bin", "tsc.js")
  const file =
    process.platform === "win32"
      ? path.join(root, "node_modules", ".bin", "tsc.cmd")
      : path.join(root, "node_modules", "typescript", "bin", "tsc")
  const ready = path.join(root, "checker-ready")
  const done = path.join(root, "checker-done")
  const body = input.wait
    ? `await Bun.write(${JSON.stringify(ready)}, "")
process.on("SIGTERM", async () => {
  await Bun.write(${JSON.stringify(done)}, "")
  process.exit(143)
})
setInterval(() => {}, 1000)
`
    : `process.stdout.write(${JSON.stringify(input.stdout ?? "")})
process.stderr.write(${JSON.stringify(input.stderr ?? "")})
process.exitCode = ${input.code ?? 0}
`
  await fs.mkdir(path.dirname(script), { recursive: true })
  await Bun.write(script, body)
  if (process.platform === "win32") {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await Bun.write(file, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
  } else {
    await Bun.write(file, `#!/usr/bin/env bun\n${body}`)
    await fs.chmod(file, 0o755)
  }
  return { file, ready, done }
}

async function waitFile(file: string) {
  if (await Bun.file(file).exists()) return

  const gate = Promise.withResolvers<void>()
  const watcher = watch(path.dirname(file), { persistent: false }, (_event, name) => {
    if (name?.toString() === path.basename(file)) gate.resolve()
  })
  watcher.once("error", gate.reject)
  if (await Bun.file(file).exists()) gate.resolve()
  const timer = setTimeout(() => gate.reject(new Error(`Timed out waiting for ${file}`)), 5_000)
  try {
    await gate.promise
  } finally {
    clearTimeout(timer)
    watcher.close()
  }
}

describe("TsCheck", () => {
  test("returns an empty map for a clean checker", async () => {
    await using tmp = await tmpdir()
    await checker(tmp.path)

    const result = await TsCheck.run(tmp.path)

    expect(result).toEqual(new Map())
  })

  test("keeps parsed file diagnostics from a nonzero checker", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "src", "broken.ts")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await Bun.write(file, "const value: string = 1\n")
    await checker(tmp.path, {
      code: 2,
      stdout: "src/broken.ts(1,7): error TS2322: Type 'number' is not assignable to type 'string'.\n",
    })

    const result = await TsCheck.run(tmp.path)
    const items = result?.get(Filesystem.normalizePath(file))

    expect(items).toHaveLength(1)
    expect(items?.[0]?.code).toBe("TS2322")
    expect(items?.[0]?.message).toContain("not assignable")
  })

  test("does not treat a failed checker without file diagnostics as clean", async () => {
    await using tmp = await tmpdir()
    await checker(tmp.path, { code: 1, stderr: "checker failed\n" })

    expect(await TsCheck.run(tmp.path)).toBeUndefined()
  })

  test("does not treat a global compiler error as clean", async () => {
    await using tmp = await tmpdir()
    await checker(tmp.path, {
      code: 1,
      stdout: "error TS18003: No inputs were found in config file 'tsconfig.json'.\n",
    })

    expect(await TsCheck.run(tmp.path)).toBeUndefined()
  })

  test("returns undefined when already aborted", async () => {
    await using tmp = await tmpdir()
    const fixture = await checker(tmp.path, { stdout: "started\n" })
    const signal = new AbortController()
    signal.abort()

    expect(await TsCheck.run(tmp.path, signal.signal)).toBeUndefined()
    expect(await Bun.file(fixture.ready).exists()).toBe(false)
  })

  test("kills and reaps an aborted checker", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir()
    const fixture = await checker(tmp.path, { wait: true })
    const signal = new AbortController()
    const task = TsCheck.run(tmp.path, signal.signal)

    try {
      await waitFile(fixture.ready)
      signal.abort()
      expect(await task).toBeUndefined()
      await waitFile(fixture.done)
    } finally {
      signal.abort()
      await task
    }
  }, 10_000)

  test("a timed-out checker returns failure and is reaped", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir()
    const fixture = await checker(tmp.path, { wait: true })
    const signal = new AbortController()
    const task = TsCheck.run(tmp.path, signal.signal)
    try {
      await waitFile(fixture.ready)
      expect(await task).toBeUndefined()
      expect(await Bun.file(fixture.done).exists()).toBe(true)
    } finally {
      signal.abort()
      await task
    }
  }, 45_000)
})
