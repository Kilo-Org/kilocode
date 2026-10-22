import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createInterface } from "node:readline"
import * as childProcess from "node:child_process"
import { once } from "node:events"
import path from "node:path"
import { sanitize } from "./response-lens-real-host-server.mjs"

// Safety preflight only, not a substitute for the packaged Codex UI gate. No
// account/read, login, thread, or model RPC is permitted here.
export async function codexIsolation(dir, run) {
  const host = await readFile(path.join(dir, "out", "extension.js"), "utf8")
  assert.ok(host.includes("CODEX_HOME"), "Installed Codex host has no CODEX_HOME routing")
  const cli = path.join(dir, "bin", "windows-x86_64", "codex.exe")
  const child = childProcess.spawn(cli, ["app-server"], {
    cwd: run.dirs.workspace,
    env: run.env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  })
  const pending = Promise.withResolvers()
  const stream = createInterface({ input: child.stdout })
  let initialized
  let size = 0
  let stderr = ""
  child.stderr.on("data", (data) => {
    stderr = sanitize((stderr + data).slice(-16000))
  })
  child.on("error", pending.reject)
  child.on("exit", (code) => pending.reject(new Error(`Codex safety preflight exited ${code}: ${stderr}`)))
  stream.on("line", (line) => {
    size += line.length
    if (size > 1024 * 1024) {
      pending.reject(new Error("Codex safety reply exceeded budget"))
      return
    }
    try {
      const body = JSON.parse(line)
      if (body.error) throw new Error(`Codex preflight RPC error: ${body.error.code}`)
      if (body.id === 1) {
        initialized = body.result
        child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`)
        child.stdin.write(
          `${JSON.stringify({ id: 2, method: "config/read", params: { includeLayers: false, cwd: run.dirs.workspace } })}\n`,
        )
      }
      if (body.id === 2) {
        const home = initialized.codexHome
        const config = body.result.config
        assert.equal(path.resolve(home).toLowerCase(), path.resolve(run.dirs.codex).toLowerCase())
        assert.equal(config.cli_auth_credentials_store, "file", "Effective Codex credentials store is not file-only")
        assert.equal(config.analytics?.enabled, false)
        pending.resolve({
          home,
          credentialStore: "file",
          telemetry: false,
          rpc: ["initialize", "config/read"],
          pid: child.pid,
        })
      }
    } catch (error) {
      pending.reject(error)
    }
  })
  const timer = setTimeout(
    () => pending.reject(new Error(`Codex auth isolation could not be proved in 30s: ${stderr}`)),
    30000,
  )
  child.stdin.write(
    `${JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "response-lens-isolation-check", version: "0.0.1" }, capabilities: { experimentalApi: true } } })}\n`,
  )
  try {
    return await pending.promise
  } finally {
    clearTimeout(timer)
    stream.close()
    child.stdin.end()
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit")
      child.kill()
      await exit
    }
  }
}
