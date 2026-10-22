import { expect, test } from "bun:test"
import { rejects } from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pkg from "../../package.json" with { type: "json" }
import { pin, stage, target } from "./bun"

const run = promisify(execFile)
const cases: [Parameters<typeof stage>[0], keyof typeof pin.artifacts, string][] = [
  [{ os: "linux", arch: "arm64" }, "linux-arm64", "bun-linux-aarch64"],
  [{ os: "linux", arch: "x64" }, "linux-x64", "bun-linux-x64"],
  [{ os: "linux", arch: "x64", avx2: false }, "linux-x64-baseline", "bun-linux-x64-baseline"],
  [{ os: "linux", arch: "arm64", abi: "musl" }, "linux-arm64-musl", "bun-linux-aarch64-musl"],
  [{ os: "linux", arch: "x64", abi: "musl" }, "linux-x64-musl", "bun-linux-x64-musl"],
  [{ os: "linux", arch: "x64", avx2: false, abi: "musl" }, "linux-x64-baseline-musl", "bun-linux-x64-musl-baseline"],
  [{ os: "darwin", arch: "arm64" }, "darwin-arm64", "bun-darwin-aarch64"],
  [{ os: "darwin", arch: "x64" }, "darwin-x64", "bun-darwin-x64"],
  [{ os: "darwin", arch: "x64", avx2: false }, "darwin-x64-baseline", "bun-darwin-x64-baseline"],
  [{ os: "win32", arch: "arm64" }, "windows-arm64", "bun-windows-aarch64"],
  [{ os: "win32", arch: "x64" }, "windows-x64", "bun-windows-x64"],
  [{ os: "win32", arch: "x64", avx2: false }, "windows-x64-baseline", "bun-windows-x64-baseline"],
]

test.each(cases)("maps %j to %s", (input, slug, name) => {
  const item = target(input)
  expect(item).toBe(pin.artifacts[slug])
  expect(item.name).toBe(name)
  expect(item.os).toBe(input.os)
  expect(item.arch).toBe(input.arch)
})

test("manifest pins all twelve immutable npm tarballs with SHA-512", () => {
  expect(pin.version).toBe("1.4.3-canary.20261021.1")
  expect(pkg.packageManager).toBe(`bun@${pin.version}`)
  expect(pin.runtime).toBe("1.4.4")
  expect(pin.revision).toBe("963452075e9d7e2a47a482f297143af5ed4f76c0")
  expect(Object.keys(pin.artifacts).sort()).toEqual(cases.map(([, slug]) => slug).sort())
  for (const item of Object.values(pin.artifacts)) {
    expect(item.tarball).toBe(`https://registry.npmjs.org/@oven/${item.name}/-/${item.name}-${pin.version}.tgz`)
    expect(item.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/)
  }
  expect(new Set(Object.values(pin.artifacts).map((item) => item.integrity)).size).toBe(12)
})

test("active workflows do not bypass the pinned runtime bootstrap", async () => {
  const dir = new URL("../../.github/workflows/", import.meta.url)
  for (const file of await readdir(dir)) {
    if (!/\.ya?ml$/.test(file)) continue
    const text = await readFile(new URL(file, dir), "utf8")
    expect(text).not.toMatch(/^\s*(?:-\s*)?uses:\s*["']?oven-sh\/setup-bun@/m)
  }
})

test("rejects unsupported targets before staging", async () => {
  for (const input of [
    { os: "freebsd", arch: "x64" },
    { os: "linux", arch: "arm" },
    { os: "darwin", arch: "arm64", abi: "musl" },
    { os: "linux", arch: "x64", abi: "../../darwin-arm64" },
    { os: "__proto__", arch: "x64" },
  ]) {
    expect(() => target(input)).toThrow("Unsupported Bun target")
    await rejects(stage(input), /Unsupported Bun target/)
  }
  expect(() => target({ os: "linux", arch: "arm64", avx2: false })).toThrow("Unsupported Bun target")
})

test("rejects a tampered cached tarball before extraction or executable use", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kilo-bun-test-"))
  try {
    const input = { os: "linux", arch: "x64", abi: "musl", avx2: false } as const
    const cache = join(dir, "kilo-bun", pin.version)
    await mkdir(cache, { recursive: true })
    const file = join(cache, `${target(input).name}.tgz`)
    await writeFile(file, "untrusted executable archive")
    const script = `const {stage} = await import(${JSON.stringify(new URL("./bun.ts", import.meta.url).href)}); await stage(${JSON.stringify(input)});`
    await rejects(
      run(process.execPath, ["--eval", script], {
        env: { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir },
        windowsHide: true,
      }),
      /Bun checksum mismatch/,
    )
    expect(await readdir(dir)).toEqual(["kilo-bun"])
    expect(await readFile(file, "utf8")).toBe("untrusted executable archive")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("install requires GITHUB_PATH before staging", async () => {
  const env = { ...process.env }
  delete env.GITHUB_PATH
  await rejects(
    run("node", [fileURLToPath(new URL("./bun.ts", import.meta.url)), "--install"], {
      env,
      windowsHide: true,
    }),
    /GITHUB_PATH is required for --install/,
  )
})

test("compiled imports do not execute the bootstrap entrypoint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kilo-bun-import-"))
  try {
    const file = join(dir, "probe.ts")
    const module = fileURLToPath(new URL("./bun.ts", import.meta.url))
    await writeFile(file, `import {pin} from ${JSON.stringify(module)}; console.log(pin.revision);`)
    const executable = join(dir, process.platform === "win32" ? "probe.exe" : "probe")
    const result = await Bun.build({ entrypoints: [file], compile: { outfile: executable } })
    expect(result.success).toBe(true)
    const output = await run(executable, [], { windowsHide: true })
    expect(output.stdout.trim()).toBe(pin.revision)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
