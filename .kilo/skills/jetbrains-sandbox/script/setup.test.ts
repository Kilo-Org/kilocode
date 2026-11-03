import { describe, expect, test } from "bun:test"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

const script = fileURLToPath(new URL("./setup.sh", import.meta.url))
const root = fileURLToPath(new URL("../../../../", import.meta.url))

async function run(args: string[], cwd = root) {
  const proc = Bun.spawn(["bash", script, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` },
  })
  const [code, out, err] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { code, out, err }
}

describe("sandbox shell entry point", () => {
  test("shows shell help", async () => {
    const result = await run(["--help"])
    expect(result.code).toBe(0)
    expect(result.out).toContain("Install IntelliJ")
    expect(result.out).toContain("up")
    expect(result.err).toBe("")
  })

  test("forwards installer help", async () => {
    const result = await run(["install", "--help"])
    expect(result.code).toBe(0)
    expect(result.out).toContain("--kilo-zip")
    expect(result.out).toContain("--origin")
  })

  test("does not start a desktop when requesting up help", async () => {
    const result = await run(["up", "--help"])
    expect(result.code).toBe(0)
    expect(result.out.match(/Usage:/g)).toHaveLength(1)
    expect(result.out).not.toContain("Desktop ready")
  })

  test("defaults options to install and retains the workspace directory guard", async () => {
    const result = await run(["--dir", root])
    expect(result.code).not.toBe(0)
    expect(result.err).toContain("Use a dedicated state directory")
  })

  test("anchors relative paths to the worktree from another directory", async () => {
    const result = await run(["run", "--dir", "."], "/tmp/kilo")
    expect(result.code).not.toBe(0)
    expect(result.err).toContain("Use a dedicated state directory")
  })

  test("does not start the desktop if installation fails", async () => {
    const result = await run(["up", "--dir", root])
    expect(result.code).not.toBe(0)
    expect(result.err.match(/^error: Use a dedicated state directory/gm)).toHaveLength(1)
    expect(result.out).not.toContain("Desktop ready")
  })

  test("preserves installer errors for unknown commands", async () => {
    const result = await run(["unknown"])
    expect(result.code).not.toBe(0)
    expect(result.err).toContain("Unknown command: unknown")
  })
})
