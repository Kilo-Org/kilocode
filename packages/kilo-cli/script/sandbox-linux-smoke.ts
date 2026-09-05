// Bundle this Node-compatible probe with Bun, then run it in disposable Linux
// with bubblewrap installed. No checkout, home directory, or credentials needed.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { prepareShell, sandboxSupport } from "../src/sandbox"

assert.equal(process.platform, "linux", "This probe requires Linux")
const support = sandboxSupport()
assert.equal(support.available, true, support.reason ?? "A usable bubblewrap backend is required")
const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-linux-shell-"))
const root = path.join(directory, "project")
const outside = path.join(directory, "outside.txt")
const denied = path.join(root, "protected.txt")
await mkdir(root)
await writeFile(outside, "outside original")
await writeFile(denied, "protected original")
const execute = promisify(execFile)
const listener = createServer((_request, response) => response.end("network control"))
await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve))
const address = listener.address()
assert(address && typeof address !== "string")

async function shell(command: string, network: "allow" | "deny" = "deny") {
  const prepared = await prepareShell(
    { command, cwd: root, shell: "/bin/sh", env: process.env },
    { enabled: true, root, denyWritePaths: [denied], network },
  )
  return execute(prepared.shell, ["-c", prepared.command], {
    cwd: prepared.cwd,
    env: prepared.env,
    timeout: 5000,
  })
}

try {
  await shell("printf allowed > allowed.txt")
  assert.equal(await readFile(path.join(root, "allowed.txt"), "utf8"), "allowed")
  await assert.rejects(shell("printf forbidden > ../outside.txt"))
  assert.equal(await readFile(outside, "utf8"), "outside original")
  await assert.rejects(shell("printf forbidden > protected.txt"))
  assert.equal(await readFile(denied, "utf8"), "protected original")
  const fetch = `${JSON.stringify(process.execPath)} -e 'fetch("http://127.0.0.1:${address.port}", {signal: AbortSignal.timeout(1500)}).then(r => r.text()).then(console.log).catch(() => process.exit(2))'`
  assert.match((await shell(fetch, "allow")).stdout, /network control/)
  await assert.rejects(shell(fetch, "deny"))
  await assert.rejects(
    prepareShell(
      { command: "true", cwd: root, shell: "/bin/sh", env: process.env },
      { enabled: true, root, denyNames: [".git"] },
    ),
    /cannot be enforced/,
  )
  console.log("KILO_LINUX_SANDBOX_OK: workspace write, outside/protected denial, network allow/deny, unsupported names refusal")
} finally {
  await new Promise<void>((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())))
  await rm(directory, { recursive: true, force: true })
}
