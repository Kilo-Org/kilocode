// Portable session-terminal PTY smoke entrypoint, bundled into the artifact by
// build-portable.ts as script/portable-pty-session-smoke-entry.js. It proves the SHIPPED
// artifact's SESSION-TERMINAL PTY path (@lydell/node-pty via the public `pty` API) works end to
// end through the REAL launched host — DISTINCT from the accepted persistent-pty daemon path
// (`experimental.persistentPty` / opencode-pty daemon). No mocks, no shell replacement:
//
//   1. HOST: the bundled interactive host launches (in-process launch(), NOT the kilo2 launcher)
//      and serves the public `pty` session-terminal API.
//   2. NATIVE BINDING: the session-terminal PTY spawns a REAL native PTY child via
//      @lydell/node-pty (the artifact-contained prebuild), with a live pid.
//   3. ROUND-TRIP: pty.create -> the command's output streams through the public terminal
//      WEBSOCKET attach (connect-token -> /connect) -> pty.update RESIZE (verified on the native
//      PTY via `stty size`, since Info.size is optional and not reported by pty.get) -> remove.
//   4. GUARANTEED CLEANUP + PROCESS-DEATH PROOF: after create, cleanup (pty.remove) runs in a
//      finally covering EVERY failure path (token/websocket/output/resize failure and a
//      deterministic induced failure) BEFORE host scope teardown; we then assert the PTY child
//      pid is actually DEAD (kill -0 -> ESRCH), not merely that remove returned. Never signals
//      unrelated processes (signal 0 only probes the owned child pid).
//
// Loopback/local only; no network, no credentials, no shell replacement.
import { NodeHttpServer } from "@effect/platform-node"
import { OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/effect/service"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"

// Assert the owned PTY child pid is dead (process.kill(pid, 0) throws ESRCH). Signal 0 only
// probes; it never sends a real signal and never touches unrelated processes.
async function assertPidDead(pid: number, label: string) {
  const alive = await Bun.spawn(["kill", "-0", String(pid)], { stdout: "ignore", stderr: "ignore" }).exited
  assert(alive !== 0, `${label} pid ${pid} must be dead (kill -0 succeeded -> still alive)`)
}

async function runPtyOnce(options: { induceFailure: boolean; out?: { pid?: number } }) {
  return await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* launch(layout("interactive"), { models: false, content: "{}" })
        const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
        const location = { directory: process.cwd() }
        // 2) Spawn a REAL session-terminal PTY via the public pty.create (uses @lydell/node-pty).
        const created = yield* Effect.promise(() =>
          client.pty.create({
            location,
            command: "sh",
            args: [],
            cwd: process.cwd(),
            title: "portable-pty-session-smoke",
            env: {},
          }),
        )
        const pty = created.data
        const childPid = pty.pid
        if (options.out) options.out.pid = childPid
        assert(pty.id, "pty.create must return a pty id")
        assert(childPid > 0, "session-terminal PTY must have a live pid")
        const headers = Service.headers(endpoint) as Record<string, string>
        try {
          if (options.induceFailure) throw new Error("induced failure after PTY create (cleanup must still run)")
          // 3) ROUND-TRIP on the interactive shell PTY via the PUBLIC terminal websocket attach
          //    (input goes through the attach websocket input frame; client.pty.write is not a
          //    public API): send `echo <marker>` (the shell is interactive, so it executes), then
          //    pty.update RESIZE, then `stty size` which must report the new size on the native PTY.
          const drive = yield* Effect.promise(async () => {
            const tokenRes = await fetch(`${endpoint.url}/api/pty/${pty.id}/connect-token`, {
              method: "POST",
              headers: { ...headers, "x-opencode-ticket": "1" },
            })
            const tokenBody = (await tokenRes.json()) as { data?: { ticket?: string } }
            const ticket = tokenBody.data?.ticket
            if (!ticket) throw new Error(`pty connect-token failed: ${JSON.stringify(tokenBody)}`)
            const wsUrl = new URL(`/api/pty/${pty.id}/connect`, endpoint.url)
            wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:"
            wsUrl.searchParams.set("ticket", ticket)
            wsUrl.searchParams.set("attachment_id", "portable-pty-session-smoke")
            const socket = new WebSocket(wsUrl)
            return await new Promise<string>((resolve, reject) => {
              let buffer = ""
              let stage = 0 // 0 = waiting for marker; 1 = resized, waiting for stty size
              const timer = setTimeout(() => {
                socket.close()
                reject(new Error(`session-pty drive timeout (stage ${stage}); captured: ${JSON.stringify(buffer)}`))
              }, 15000)
              socket.addEventListener("open", () => socket.send("echo SESSION_MARKER_artifact-ok\n"))
              socket.addEventListener("message", (event) => {
                const chunk =
                  typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
                buffer += chunk
                if (stage === 0 && buffer.includes("SESSION_MARKER_artifact-ok")) {
                  stage = 1
                  // Resize the native PTY, then ask the shell for its size.
                  void client.pty
                    .update({ location, ptyID: pty.id, size: { cols: 100, rows: 40 } })
                    .then(() => socket.send("stty size\n"))
                    .catch((e) => {
                      clearTimeout(timer)
                      reject(new Error(`pty.update resize failed: ${String(e)}`))
                    })
                }
                if (stage === 1 && /40\s+100/.test(buffer)) {
                  clearTimeout(timer)
                  socket.close()
                  resolve(buffer)
                }
              })
              socket.addEventListener("error", (event) => {
                clearTimeout(timer)
                reject(new Error(`session-pty drive websocket error: ${String(event)}`))
              })
              socket.addEventListener("close", (event) => {
                if (!(stage === 1 && /40\s+100/.test(buffer))) {
                  clearTimeout(timer)
                  reject(
                    new Error(
                      `session-pty drive closed (${event.code}) at stage ${stage}; captured: ${JSON.stringify(buffer.slice(0, 300))}`,
                    ),
                  )
                }
              })
            })
          })
          assert(
            drive.includes("SESSION_MARKER_artifact-ok"),
            `session-pty output must contain the command marker:\n${drive}`,
          )
          assert(/40\s+100/.test(drive), `resize must take effect on the native PTY (stty size -> "40 100"):\n${drive}`)
        } finally {
          // GUARANTEED CLEANUP on success AND every failure path, before host scope teardown. The
          // remove RPC may race the child's own exit; swallow it — the pid-death proof is the real check.
          yield* Effect.promise(() => client.pty.remove({ location, ptyID: pty.id }).catch(() => {}))
        }
        return { ptyID: pty.id, pid: childPid }
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
  )
}

async function main() {
  // PASS 1 (success): create -> output -> resize -> remove -> pid-death proof.
  const success = await runPtyOnce({ induceFailure: false })
  await assertPidDead(success.pid, "session-terminal PTY child")

  // PASS 2 (induced failure): create -> deterministic failure -> guaranteed cleanup -> death proof.
  const failureOut: { pid?: number } = {}
  let failed = false
  try {
    await runPtyOnce({ induceFailure: true, out: failureOut })
  } catch {
    failed = true
  }
  assert(failed, "induced-failure pass must actually fail")
  assert(failureOut.pid !== undefined, "induced-failure pass must have created the PTY before failing")
  await assertPidDead(failureOut.pid, "session-terminal PTY child (induced-failure path)")

  return { output: "SESSION_MARKER_artifact-ok", resized: true, successPidDead: true, inducedFailureCleaned: true }
}

try {
  const result = await main()
  console.log(`KILO_PORTABLE_PTY_SESSION_SMOKE_OK ${JSON.stringify(result)}`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
