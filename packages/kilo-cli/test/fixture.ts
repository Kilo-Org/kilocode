import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { layout, type Layout } from "../src/paths"

export const FIXTURE_ROOT_ENV = "KILO_TEST_FIXTURE_ROOT"

export const entry = path.resolve(import.meta.dir, "../src/index.ts")

export async function fixture(binary?: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-preview-test-"))
  try {
    const home = path.join(directory, "home")
    const cwd = path.join(directory, "project")
    const tmp = path.join(directory, "tmp")
    await Promise.all([home, cwd, tmp].map((directory) => mkdir(directory, { recursive: true })))
    const env = {
      [FIXTURE_ROOT_ENV]: directory,
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      HOME: home,
      USERPROFILE: home,
      TMPDIR: tmp,
      TMP: tmp,
      TEMP: tmp,
      XDG_DATA_HOME: path.join(home, "data"),
      XDG_CONFIG_HOME: path.join(home, "config"),
      XDG_CACHE_HOME: path.join(home, "cache"),
      XDG_STATE_HOME: path.join(home, "state"),
      TERM: "dumb",
    }
    const input = { directory, home, cwd, env, binary }
    const result = await run(input, ["paths"])
    if (result.code !== 0) throw new Error(result.stderr)
    const layout: Layout = JSON.parse(result.stdout)
    return {
      ...input,
      layout,
      [Symbol.asyncDispose]: () => rm(directory, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

export type Fixture = Awaited<ReturnType<typeof fixture>>

// Canonical containment including symlinks: realpath the deepest existing
// ancestor of the candidate and rejoin the not-yet-existing tail.
function contained(root: string, candidate: string): boolean {
  const rootReal = realpathSync(root)
  let current = candidate
  const tail: string[] = []
  while (true) {
    let real: string
    try {
      real = realpathSync(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      tail.unshift(path.basename(current))
      const parent = path.dirname(current)
      if (parent === current) return false
      current = parent
      continue
    }
    const resolved = tail.length > 0 ? path.join(real, ...tail) : real
    const relative = path.relative(rootReal, resolved)
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  }
}

// Fail-closed guard for fixture entrypoints that launch hosts and write
// credentials: the wrapper sets KILO_TEST_FIXTURE_ROOT to its temp root, and the
// guard refuses unless every resolved interactive-store path (database, config,
// data, state, cache, tmp) is canonically contained in that root. Call before
// any launcher or credential write; direct `bun run <fixture>` invocations
// refuse here because the marker is absent.
export function guardedFixtureLayout(): Layout {
  const root = process.env[FIXTURE_ROOT_ENV]
  if (!root) {
    throw new Error(
      "fixture entry invoked outside the test wrapper: refusing to touch the real user store; run the wrapper test instead",
    )
  }
  const resolved = layout("interactive")
  const candidates = [
    resolved.database,
    resolved.config,
    resolved.tuiConfig,
    resolved.telemetryConfig,
    resolved.password,
    resolved.pty,
    resolved.paths.data,
    resolved.paths.config,
    resolved.paths.cache,
    resolved.paths.state,
    resolved.paths.tmp,
  ]
  for (const candidate of candidates) {
    if (!contained(root, candidate)) {
      throw new Error(`refusing: resolved store path ${candidate} escapes the fixture root ${root}`)
    }
  }
  return resolved
}

export function testArtifactDir() {
  const directory = process.env.KILO_CLI_TEST_ARTIFACT_DIR
  if (!directory) {
    throw new Error(
      "compiled-mode tests require a current build artifact: run `bun run script/test.ts` from packages/kilo-cli (with the packaged dist/interactive/bun runtime) or set KILO_CLI_TEST_ARTIFACT_DIR; silently falling back to ../dist executed a stale dist/kilo2 built by an unsupported Bun",
    )
  }
  if (!existsSync(directory)) {
    throw new Error(
      `KILO_CLI_TEST_ARTIFACT_DIR points at a missing directory: ${directory}; run \`bun run script/test.ts\` from packages/kilo-cli to build a current artifact`,
    )
  }
  return directory
}

export function compiledBinary(directory = testArtifactDir()) {
  const binary = path.join(directory, process.platform === "win32" ? "kilo2.exe" : "kilo2")
  if (!existsSync(binary)) {
    throw new Error(
      `compiled artifact binary is missing: ${binary}; run \`bun run script/test.ts\` from packages/kilo-cli to build a current artifact`,
    )
  }
  return binary
}

type Input = { cwd: string; env: NodeJS.ProcessEnv; binary?: string }

export function start(input: Input, args: string[], binary = input.binary) {
  return Bun.spawn(binary ? [binary, ...args] : [process.execPath, "--no-env-file", entry, ...args], {
    cwd: input.cwd,
    env: input.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: 15_000,
  })
}

export async function run(input: Input, args: string[], binary = input.binary) {
  const child = start(input, args, binary)
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

export async function readyProcess(child: ReturnType<typeof start>, pattern: RegExp, errors: Promise<string>) {
  try {
    return await ready(child.stdout, pattern)
  } catch (error) {
    const stderr = await errors
    throw new Error(stderr ? `${(error as Error).message}\nchild stderr:\n${stderr}` : (error as Error).message)
  }
}

export async function ready(stream: ReadableStream<Uint8Array>, pattern: RegExp) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  try {
    while (true) {
      const value = await reader.read()
      if (value.done) throw new Error(`Process closed before ready: ${chunks.join("")}`)
      chunks.push(decoder.decode(value.value, { stream: true }))
      const text = chunks.join("")
      const match = text.match(pattern)
      if (match) return { value: match[1], text }
    }
  } finally {
    reader.releaseLock()
  }
}
