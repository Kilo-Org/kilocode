import { expect, test } from "bun:test"
import { rejects } from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { watch } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises"
import { createServer, type ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pkg from "../../package.json" with { type: "json" }
import { host, pin, stage, target } from "./bun"

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

test.each([
  [{ os: "linux", arch: "x64", report: { header: { glibcVersionRuntime: "2.36" } } }, "bun-linux-x64-baseline"],
  [{ os: "linux", arch: "x64", report: { header: {} } }, "bun-linux-x64-musl-baseline"],
  [{ os: "linux", arch: "x64", report: { header: { glibcVersionRuntime: undefined } } }, "bun-linux-x64-musl-baseline"],
  [{ os: "linux", arch: "x64", report: { header: { glibcVersionRuntime: "" } } }, "bun-linux-x64-musl-baseline"],
  [{ os: "linux", arch: "arm64", report: { header: { glibcVersionRuntime: "2.36" } } }, "bun-linux-aarch64"],
  [{ os: "linux", arch: "arm64", report: { header: {} } }, "bun-linux-aarch64-musl"],
  [{ os: "darwin", arch: "x64", report: { header: {} } }, "bun-darwin-x64-baseline"],
  [{ os: "darwin", arch: "arm64" }, "bun-darwin-aarch64"],
  [{ os: "win32", arch: "x64", report: { header: {} } }, "bun-windows-x64-baseline"],
  [{ os: "win32", arch: "arm64" }, "bun-windows-aarch64"],
] satisfies [Parameters<typeof host>[0], string][])("selects host %j as %s", (input, name) => {
  expect(target(host(input)).name).toBe(name)
})

test("host defaults to the running process", () => {
  expect(host().os).toBe(process.platform)
  expect(host().arch).toBe(process.arch)
  expect(target(host())).toBeDefined()
})

test("Node bootstrap and Bun select the same native runtime artifact", async () => {
  const url = new URL("./bun.ts", import.meta.url).href
  const result = await run(
    "node",
    [
      "--input-type=module",
      "--eval",
      `import { host, target } from ${JSON.stringify(url)}; console.log(target(host()).name)`,
    ],
    { windowsHide: true },
  )
  const expected = result.stdout.trim()
  const actual = target(host()).name
  console.log(`Native Bun artifact: Node=${expected}, Bun=${actual}`)
  expect(actual).toBe(expected)
})

test("manifest pins all twelve immutable npm tarballs with SHA-512", () => {
  expect(pin.version).toBe("1.4.4")
  expect(pkg.packageManager).toBe(`bun@${pin.version}`)
  expect(pin.runtime).toBe("1.4.4")
  expect(pin.revision).toBe("38afee6c84fcf48c0edb2466aa4b27d287a59c30")
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

async function fixture(
  check: (data: {
    dir: string
    file: string
    bytes: Buffer<ArrayBuffer>
    item: ReturnType<typeof target>
    input: Parameters<typeof stage>[0]
    requests: string[]
  }) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "kilo-bun-test-"))
  const input = { os: "linux", arch: "x64", abi: "musl", avx2: false } as const
  const item = target(input)
  const original = { ...item }
  const env = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP }
  const server = createServer()
  try {
    await mkdir(join(dir, "package", "bin"), { recursive: true })
    await writeFile(join(dir, "package", "bin", "bun"), "fixture-runtime")
    const archive = join(dir, "fixture.tgz")
    const tar =
      process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar"
    await run(tar, ["-czf", archive, "-C", dir, "package"], { windowsHide: true })
    const bytes = await readFile(archive)
    const requests: string[] = []
    const pending: ServerResponse[] = []
    server.on("request", (request, response) => {
      requests.push(request.url ?? "/")
      if (request.url === "/concurrent") {
        pending.push(response)
        if (pending.length === 2) for (const response of pending) response.end(bytes)
        return
      }
      response.end(request.url === "/bad" ? bytes.subarray(0, 10) : bytes)
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing fixture server port")
    item.tarball = `http://127.0.0.1:${address.port}/good`
    item.integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`
    process.env.TMPDIR = dir
    process.env.TMP = dir
    process.env.TEMP = dir
    const cache = join(dir, `kilo-bun-${process.getuid?.() ?? 0}`, pin.version)
    await mkdir(cache, { recursive: true, mode: 0o700 })
    await check({ dir, file: join(cache, `${item.name}.tgz`), bytes, item, input, requests })
  } finally {
    Object.assign(item, original)
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete process.env[key]
        continue
      }
      process.env[key] = value
    }
    if (server.listening) {
      const closed = once(server, "close")
      server.closeAllConnections()
      server.close()
      await closed
    }
    await rm(dir, { recursive: true, force: true })
  }
}

test.skipIf(!process.getuid).serial("rejects a cache accessible to other users before downloading", async () => {
  await fixture(async ({ file, input, requests }) => {
    await chmod(dirname(dirname(file)), 0o777)
    await rejects(stage(input), /Bun cache directory is not private/)
    expect(requests).toEqual([])
  })
})

test.skipIf(!process.getuid).serial("rejects a symlinked cache without writing through it", async () => {
  await fixture(async ({ dir, file, input, requests }) => {
    const root = dirname(dirname(file))
    const outside = join(dir, "outside")
    await mkdir(outside, { mode: 0o700 })
    await rename(root, `${root}.private`)
    await symlink(outside, root)
    await rejects(stage(input), /Bun cache directory is not private/)
    expect(await readdir(outside)).toEqual([])
    expect(requests).toEqual([])
  })
})

test.serial("recovers a truncated cache with one verified download", async () => {
  await fixture(async ({ file, bytes, input, requests }) => {
    await writeFile(file, bytes.subarray(0, 10))
    const executable = await stage(input)
    expect(isAbsolute(executable)).toBe(true)
    expect(await readFile(executable, "utf8")).toBe("fixture-runtime")
    expect(await readFile(file)).toEqual(bytes)
    expect(requests).toEqual(["/good"])
  })
})

test.serial("rejects bad downloaded bytes without caching, extracting, or retrying", async () => {
  await fixture(async ({ dir, file, bytes, item, input, requests }) => {
    await writeFile(file, bytes.subarray(0, 10))
    item.tarball = new URL("/bad", item.tarball).href
    const before = await readdir(dir)
    await rejects(stage(input), /Bun checksum mismatch/)
    expect(requests).toEqual(["/bad"])
    expect(await readdir(dirname(file))).toEqual([])
    expect(await readdir(dir)).toEqual(before)
  })
})

test.serial("publishes complete caches atomically while concurrent callers extract privately", async () => {
  await fixture(async ({ file, bytes, item, input, requests }) => {
    item.tarball = new URL("/concurrent", item.tarball).href
    const samples: Promise<Buffer | undefined>[] = []
    const changed = Promise.withResolvers<void>()
    const watcher = watch(dirname(file), (_, name) => {
      if (String(name) !== basename(file)) return
      samples.push(
        readFile(file).catch((err: NodeJS.ErrnoException) => {
          if (err.code === "ENOENT") return undefined
          throw err
        }),
      )
      changed.resolve()
    })
    try {
      const paths = await Promise.all([stage(input), stage(input)])
      await changed.promise
      expect(new Set(paths).size).toBe(2)
      for (const path of paths) expect(await readFile(path, "utf8")).toBe("fixture-runtime")
      expect(requests).toEqual(["/concurrent", "/concurrent"])
      expect(await readFile(file)).toEqual(bytes)
      expect(samples.length).toBeGreaterThan(0)
      for (const sample of await Promise.all(samples)) if (sample) expect(sample).toEqual(bytes)
      expect(await readdir(dirname(file))).toEqual([basename(file)])
    } finally {
      watcher.close()
    }
  })
})

test.serial("cache mutation cannot tamper with staged executables or later extractions", async () => {
  await fixture(async ({ file, bytes, input, requests }) => {
    const first = await stage(input)
    await writeFile(file, "tampered cache")
    expect(await readFile(first, "utf8")).toBe("fixture-runtime")
    const second = await stage(input)
    expect(second).not.toBe(first)
    expect(await readFile(second, "utf8")).toBe("fixture-runtime")
    expect(await readFile(file)).toEqual(bytes)
    await writeFile(first, "tampered executable")
    const third = await stage(input)
    expect(third).not.toBe(first)
    expect(third).not.toBe(second)
    expect(await readFile(third, "utf8")).toBe("fixture-runtime")
    expect(requests).toEqual(["/good", "/good"])
  })
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
