import { expect, test } from "bun:test"
import path from "node:path"

/**
 * The engine logger is opt-in and diagnostic-only. Anything on stdout would
 * corrupt stdio protocols such as ACP, so both streams must stay silent unless
 * `KILO_INDEXING_LOG` is set explicitly, and output then belongs on stderr.
 *
 * The module reads the environment once at import time, so each case runs in its
 * own process.
 */
const module = path.join(import.meta.dir, "..", "src", "util", "log.ts")
const script = `
  const { Log } = await import(${JSON.stringify(module)})
  Log.create({ service: "probe" }).warn("probe line", { detail: 1 })
`

function run(env: Record<string, string>) {
  return Bun.spawn([process.execPath, "--no-env-file", "-e", script], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
}

test("logging stays off on both streams by default", async () => {
  const child = run({})

  expect(await child.exited).toBe(0)
  expect(await new Response(child.stdout).text()).toBe("")
  expect(await new Response(child.stderr).text()).toBe("")
})

test("explicitly enabled logging writes JSON to stderr and never stdout", async () => {
  for (const value of ["1", "true"]) {
    const child = run({ KILO_INDEXING_LOG: value })

    expect(await child.exited).toBe(0)
    expect(await new Response(child.stdout).text()).toBe("")
    const diagnostics = await new Response(child.stderr).text()
    expect(diagnostics).toContain('"probe line"')
    expect(diagnostics).toContain('"service":"probe"')
    expect(diagnostics).toContain('"level":"WARN"')
  }
})

test("an unset or unrecognised value keeps logging off", async () => {
  for (const value of ["", "0", "yes"]) {
    const child = run({ KILO_INDEXING_LOG: value })

    expect(await child.exited).toBe(0)
    expect(await new Response(child.stdout).text()).toBe("")
    expect(await new Response(child.stderr).text()).toBe("")
  }
})
