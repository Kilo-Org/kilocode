import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { isResponse, type Request } from "../src/mutation-protocol"

const roots: string[] = []

async function worker(request: Request) {
  const entry = fileURLToPath(new URL("../src/kilo-sandbox-mutation-worker.ts", import.meta.url))
  const proc = Bun.spawn([process.execPath, entry], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  await proc.stdin.write(JSON.stringify(request))
  await proc.stdin.end()
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(stderr || `Filesystem worker exited ${code}`)
  const response: unknown = JSON.parse(stdout)
  if (!isResponse(response)) throw new Error("Filesystem worker returned an invalid response")
  return response
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("filesystem mutation worker", () => {
  test("executes ordered mutation batches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-mutation-worker-"))
    roots.push(root)
    const dir = path.join(root, "nested")
    const file = path.join(dir, "value.txt")
    const response = await worker({
      op: "batch",
      operations: [
        { op: "makeDirectory", path: dir, options: { recursive: true } },
        { op: "writeFileString", path: file, data: "batched" },
        { op: "chmod", path: file, mode: 0o640 },
      ],
    })

    expect(response).toEqual({ ok: true })
    expect(await readFile(file, "utf8")).toBe("batched")
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o640)
  })

  test("serializes single-operation filesystem failures", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-mutation-worker-"))
    roots.push(root)
    const response = await worker({ op: "writeFileString", path: path.join(root, "missing", "value.txt"), data: "x" })

    expect(response.ok).toBe(false)
    if (response.ok) return
    expect(response.error.message).toContain("no such file or directory")
    expect(response.error.operation).toBe("writeFileString")
    expect(response.error.code).toBe("ENOENT")
  })

  test("reports the failed operation and stops the remaining batch", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-mutation-worker-"))
    roots.push(root)
    const missing = path.join(root, "missing", "value.txt")
    const skipped = path.join(root, "skipped.txt")
    const response = await worker({
      op: "batch",
      operations: [
        { op: "writeFileString", path: missing, data: "blocked" },
        { op: "writeFileString", path: skipped, data: "skipped" },
      ],
    })

    expect(response.ok).toBe(false)
    if (response.ok) return
    expect(response.error.operation).toBe("writeFileString")
    expect(response.error.code).toBe("ENOENT")
    expect(await Bun.file(skipped).exists()).toBe(false)
  })
})
