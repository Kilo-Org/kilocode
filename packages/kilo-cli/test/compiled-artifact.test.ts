import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { compiledBinary, readyProcess, start, testArtifactDir } from "./fixture"

function withoutArtifactEnv() {
  const previous = process.env.KILO_CLI_TEST_ARTIFACT_DIR
  delete process.env.KILO_CLI_TEST_ARTIFACT_DIR
  return () => {
    if (previous === undefined) delete process.env.KILO_CLI_TEST_ARTIFACT_DIR
    else process.env.KILO_CLI_TEST_ARTIFACT_DIR = previous
  }
}

test("compiled artifact resolution requires an explicit current artifact instead of stale dist", () => {
  const restore = withoutArtifactEnv()
  try {
    expect(() => testArtifactDir()).toThrow(/KILO_CLI_TEST_ARTIFACT_DIR|script\/test\.ts/)
  } finally {
    restore()
  }
})

test("compiled artifact resolution refuses a missing artifact directory", () => {
  const restore = withoutArtifactEnv()
  process.env.KILO_CLI_TEST_ARTIFACT_DIR = path.join(os.tmpdir(), "kilo-compiled-artifact-missing-does-not-exist")
  try {
    expect(() => testArtifactDir()).toThrow(/missing directory/)
  } finally {
    restore()
  }
})

test("compiled artifact resolution refuses a directory without the compiled binary", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-compiled-artifact-empty-"))
  try {
    expect(() => compiledBinary(directory)).toThrow(/binary is missing/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("a compiled child that dies before ready reports its stderr for diagnosis", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-compiled-artifact-stale-"))
  const binary = path.join(directory, process.platform === "win32" ? "kilo2.exe" : "kilo2")
  await writeFile(
    binary,
    "#!/bin/sh\necho 'Kilo v2 requires Bun 1.4.0 or newer; found 1.3.14.' >&2\nexit 1\n",
    { mode: 0o755 },
  )
  try {
    const child = start({ cwd: directory, env: { PATH: process.env.PATH } }, ["serve"], binary)
    const errors = new Response(child.stderr).text()
    try {
      await expect(readyProcess(child, /URL: (http:\/\/127\.0\.0\.1:\d+)/, errors)).rejects.toThrow(/found 1\.3\.14/)
    } finally {
      child.kill("SIGTERM")
      await child.exited
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
