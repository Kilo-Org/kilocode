import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { binary } from "../src/nono-binary"
import type { Profile } from "../src/profile"

// Resolve the staged binary before the fixture moves the sandbox state away from it.
const stage = binary()
const mac = process.platform === "darwin"
const root = stage && mac ? mkdtempSync(path.join(os.tmpdir(), "kilo-nono-worker-")) : undefined
const workspace = root ? path.join(root, "workspace") : ""
const temporary = root ? path.join(root, "tmp") : ""
const state = root ? path.join(root, "state", "sandbox") : ""
// nono refuses a state root inside a path its default profile reads, and the fixture lives under the system
// temp directory, so nono's own state goes beside the real home instead.
const nonoHome = root ? path.join(os.homedir(), `.kilo-nono-worker-${process.pid}-${Date.now()}`) : ""

if (root) {
  process.env.KILO_V2_DEV = "1"
  process.env.KILO_SANDBOX_BACKEND = "nono"
  process.env.KILO_NONO_PATH = stage
  process.env.KILO_NONO_STATE = state
  process.env.KILO_NONO_HOME = nonoHome
  mkdirSync(workspace, { recursive: true })
  mkdirSync(temporary, { recursive: true })
}

const context = await import("../src/context")
const backend = await import("../src/backend")

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  if (nonoHome) rmSync(nonoHome, { recursive: true, force: true })
  for (const key of ["KILO_V2_DEV", "KILO_SANDBOX_BACKEND", "KILO_NONO_PATH", "KILO_NONO_STATE", "KILO_NONO_HOME"]) {
    delete process.env[key]
  }
})

function profile(): Profile {
  return {
    filesystem: {
      allowWrite: [
        { path: workspace, kind: "subtree" },
        { path: temporary, kind: "subtree" },
        // The worker entry imports its protocol module from the package, so the command must read it.
        { path: path.resolve(import.meta.dir, ".."), kind: "subtree" },
      ],
      denyWrite: [{ path: state, kind: "subtree" }],
      denyNames: [],
      temporaryDirectory: temporary,
    },
    network: { mode: "deny", allowedHosts: [] },
    environment: { deny: [], set: { TMPDIR: temporary, TMP: temporary, TEMP: temporary } },
  }
}

test.skipIf(!root)("runs a file-write request through the mutation worker inside nono", async () => {
  const target = path.join(temporary, "written.txt")
  const launch = {
    command: process.execPath,
    args: [path.join(import.meta.dir, "..", "src", "kilo-sandbox-mutation-worker.ts")],
    cwd: workspace,
    environment: { ...process.env, HOME: process.env.HOME ?? os.homedir() },
  }
  const prepared = await Effect.runPromise(Effect.scoped(context.run(profile(), backend.confine(profile(), launch))))
  const child = Bun.spawn({
    cmd: [prepared.command, ...prepared.args],
    cwd: prepared.cwd,
    env: prepared.environment,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(60_000),
  })
  child.stdin.write(JSON.stringify({ op: "writeFileString", path: target, data: "worker-ok" }) + "\n")
  child.stdin.end()
  const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  const code = await child.exited
  expect({ code, err: err.trim() }).toEqual({ code: 0, err: "" })
  expect(out.trim()).toBe('{"ok":true}')
  expect(readFileSync(target, "utf8")).toBe("worker-ok")
})
