import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Layout } from "../src/paths"

export const entry = path.resolve(import.meta.dir, "../src/index.ts")

export async function fixture(binary?: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-preview-test-"))
  try {
    const home = path.join(directory, "home")
    const cwd = path.join(directory, "project")
    const tmp = path.join(directory, "tmp")
    await Promise.all([home, cwd, tmp].map((directory) => mkdir(directory, { recursive: true })))
    const env = {
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
