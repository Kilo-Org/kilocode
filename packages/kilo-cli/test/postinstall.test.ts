import { expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { launcherPostinstall, transformPostinstall } from "../script/postinstall"

const registry = "https://registry.npmjs.org"
const version = "0.0.0-v2-999"
const posix = test.skipIf(process.platform === "win32")
const platforms: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" }
const architectures: Record<string, string> = { x64: "x64", arm64: "arm64", arm: "arm" }
const platform = platforms[process.platform] ?? process.platform
const arch = architectures[process.arch] ?? process.arch
const binary = process.platform === "win32" ? "kilo2.exe" : "kilo2"
const base = `@kilocode/cli-${platform}-${arch}`
const names = [
  base,
  `${base}-baseline`,
  `${base}-musl`,
  `${base}-baseline-musl`,
  ...(platform === "windows" && arch === "arm64"
    ? [base.replace(/-arm64$/, "-x64"), base.replace(/-arm64$/, "-x64-baseline")]
    : []),
]
const dependencies = Object.fromEntries(names.map((name) => [name, version]))

// The generated script spawns npm and the copied binary, so both are fakes inside the unique fixture.
const fakeNpm = [
  'import fs from "node:fs"',
  'import path from "node:path"',
  "",
  "const args = process.argv.slice(2)",
  'const prefix = args[args.indexOf("--prefix") + 1]',
  "const spec = args[args.length - 1]",
  'const at = spec.lastIndexOf("@")',
  "const name = spec.slice(0, at)",
  "const installed = spec.slice(at + 1)",
  'const directory = path.join(prefix, "node_modules", name)',
  'fs.mkdirSync(path.join(directory, "bin"), { recursive: true })',
  'fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: installed }))',
  'const binary = path.join(directory, "bin", process.env.FAKE_BIN)',
  `fs.writeFileSync(binary, "#!/bin/sh\\nprintf '%s\\\\n' " + JSON.stringify(process.env.FAKE_VERSION_OUTPUT || "") + "\\n")`,
  "fs.chmodSync(binary, 0o755)",
  'fs.appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify(args) + "\\n")',
  "",
].join("\n")

async function withFixture(body: (root: string) => Promise<void>) {
  const parent = path.resolve(import.meta.dirname, "../node_modules/.kilo-postinstall-tests")
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(path.join(parent, "run-"))
  try {
    await body(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function createLauncher(root: string) {
  const launcher = path.join(root, "launcher")
  await mkdir(path.join(launcher, "bin"), { recursive: true })
  await writeFile(
    path.join(launcher, "package.json"),
    JSON.stringify({
      name: "@kilocode/cli",
      version,
      bin: { kilo2: `./bin/${binary}` },
      optionalDependencies: dependencies,
    }),
  )
  await writeFile(path.join(launcher, "postinstall.mjs"), await launcherPostinstall())
  return launcher
}

async function createPlatformPackages(launcher: string, output: string, renderer = false) {
  for (const name of names) {
    const directory = path.join(launcher, "node_modules", name)
    await mkdir(path.join(directory, "bin"), { recursive: true })
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ name, version }))
    const source = path.join(directory, "bin", binary)
    await writeFile(source, `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(output)}\n`)
    await chmod(source, 0o755)
    if (renderer) await writeFile(path.join(directory, "bin/libopentui.dylib"), "renderer contents")
  }
}

async function run(root: string, output: string) {
  const launcher = path.join(root, "launcher")
  const tmp = path.join(root, "tmp")
  const npm = path.join(root, "npm-cli.js")
  const log = path.join(root, "npm.log")
  await Promise.all(
    [tmp, path.join(root, "home"), path.join(root, "data"), path.join(root, "config"), path.join(root, "cache")].map(
      (directory) => mkdir(directory, { recursive: true }),
    ),
  )
  await writeFile(npm, fakeNpm)
  const result = Bun.spawnSync([process.execPath, path.join(launcher, "postinstall.mjs")], {
    cwd: launcher,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: path.join(root, "home"),
      TMPDIR: tmp,
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      npm_execpath: npm,
      FAKE_BIN: binary,
      FAKE_VERSION_OUTPUT: output,
      FAKE_NPM_LOG: log,
    },
    timeout: 15_000,
  })
  const calls = (await Bun.file(log).exists())
    ? (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[])
    : []
  return { result, calls, tmp, target: path.join(launcher, "bin", binary) }
}

function expectPinned(args: string[]) {
  expect(args[0]).toBe("install")
  expect(args).toContain("--ignore-scripts")
  expect(args).toContain("--no-save")
  expect(args).toContain("--loglevel=error")
  expect(args).toContain(`--registry=${registry}`)
  expect(args).toContain(`--@kilocode:registry=${registry}`)
  const spec = args.at(-1)!
  const at = spec.lastIndexOf("@")
  expect(names).toContain(spec.slice(0, at))
  expect(spec.slice(at + 1)).toBe(version)
}

// The fixture uses a POSIX executable; the Linux case also proves a missing macOS sidecar is harmless.
posix.each([true, false])("npm postinstall stages the renderer next to kilo2 when present (%s)", async (withRenderer) =>
  withFixture(async (root) => {
    const launcher = await createLauncher(root)
    await createPlatformPackages(launcher, `kilo2 v${version}`, withRenderer)
    const { result, calls } = await run(root, `kilo2 v${version}`)

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(calls).toEqual([])
    const installed = Bun.file(path.join(launcher, "bin/libopentui.dylib"))
    if (withRenderer) expect(await installed.text()).toBe("renderer contents")
    else expect(await installed.exists()).toBe(false)
  }),
)

posix(
  "npm postinstall pins the public registries and exact package when the platform dependency is missing",
  async () =>
    withFixture(async (root) => {
      await createLauncher(root)
      const { result, calls, tmp, target } = await run(root, `kilo2 v${version}`)

      expect(result.exitCode, result.stderr.toString()).toBe(0)
      expect(calls).toHaveLength(1)
      expectPinned(calls[0]!)
      const prefix = calls[0]![calls[0]!.indexOf("--prefix") + 1]!
      expect(prefix.startsWith(`${tmp}${path.sep}`)).toBe(true)
      const installed = Bun.spawnSync([target, "--version"])
      expect(installed.exitCode).toBe(0)
      expect(installed.stdout.toString().trim()).toBe(`kilo2 v${version}`)
    }),
)

posix("npm postinstall rejects a fallback binary that does not report the launcher version", async () =>
  withFixture(async (root) => {
    await createLauncher(root)
    const { result, calls } = await run(root, `kilo2 v0.0.0-v2-998`)

    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain("Failed to install Kilo")
    expect(calls.length).toBeGreaterThan(0)
    for (const args of calls) expectPinned(args)
  }),
)

posix("npm postinstall rejects a copied binary that does not report the launcher version", async () =>
  withFixture(async (root) => {
    const launcher = await createLauncher(root)
    await createPlatformPackages(launcher, "kilo2 v0.0.0-v2-998")
    const { result, calls } = await run(root, `kilo2 v${version}`)

    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain("Failed to install Kilo")
    expect(calls).toEqual([])
  }),
)

test("npm postinstall transform refuses an upstream script without the expected anchors", () => {
  expect(() => transformPostinstall("")).toThrow("postinstall.mjs changed")
})
