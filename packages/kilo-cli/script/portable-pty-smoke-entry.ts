// Portable PTY smoke entrypoint, bundled into the artifact by build-portable.ts as
// script/portable-pty-smoke-entry.js. It proves the SHIPPED artifact's native PTY path works
// end to end through the REAL launched host and the PUBLIC client API, with a REAL native PTY
// (no mocks, no shell replacement):
//
//   1. NATIVE BINARY RESOLUTION: import { binaryPath } from "@opencode-ai/pty" resolves to the
//      artifact-CONTAINED opencode-pty binary (inside the relocated .store), and that file
//      exists — the runtime does not fall back to a checkout or a PATH lookup.
//   2. HOST: the bundled interactive host launches (direct-host proof, accurately labeled: this
//      is in-process launch(), NOT the kilo2 launcher — the launcher host-boot is proven
//      separately by portable-launcher-smoke-entry.js) and serves the public persistentPty API.
//   3. REAL PTY ROUND-TRIP: persistentPty.create spawns a real native PTY; the command output is
//      captured via the PUBLIC terminal WEBSOCKET ATTACH (connect-token -> /connect), because the
//      HTTP read/snapshot returns the rendered screen only when a controller is attached.
//   4. GUARANTEED CLEANUP + PROCESS-DEATH PROOF: after create, cleanup runs in a finally that
//      covers EVERY failure path (token failure, websocket failure, marker timeout, induced
//      failure) BEFORE host scope teardown; we then assert BOTH the terminal child pid (pty.pid)
//      AND the artifact's opencode-pty daemon process are actually DEAD — not merely that the
//      shutdown RPC returned. We never signal unrelated processes (the daemon match is scoped to
//      the artifact's own binary path).
//
// Loopback/local only; no network, no credentials, no shell replacement.
import { NodeHttpServer } from "@effect/platform-node"
import { OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/effect/service"
import { binaryPath } from "@opencode-ai/pty"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"

const artifactRoot = process.env.KILO_PORTABLE_ARTIFACT_ROOT
assert(artifactRoot, "KILO_PORTABLE_ARTIFACT_ROOT must point at the relocated artifact")
assert(binaryPath, "opencode-pty binaryPath must be defined on darwin-arm64")
assert(existsSync(binaryPath), `opencode-pty binary must exist: ${binaryPath}`)

// Assert a pid is dead (process.kill(pid, 0) throws ESRCH). Never signals: signal 0 probes only.
async function assertPidDead(pid: number, label: string) {
  const alive = await Bun.spawn(["kill", "-0", String(pid)], { stdout: "ignore", stderr: "ignore" }).exited
  assert(alive !== 0, `${label} pid ${pid} must be dead (kill -0 succeeded -> still alive)`)
}

// Assert NO opencode-pty daemon spawned from THIS artifact's binary is alive. Scoped to the
// artifact's own binary path so unrelated opencode-pty processes (other checkouts) never match
// and are never touched.
async function assertNoArtifactDaemon(binaryReal: string) {
  const proc = Bun.spawn(["pgrep", "-f", `${binaryReal} daemon`], { stdout: "pipe", stderr: "ignore" })
  const found = (await new Response(proc.stdout).text()).trim()
  await proc.exited
  assert(found === "", `artifact opencode-pty daemon must be dead; still alive (pids): ${found}`)
}

async function runPtyOnce(options: { induceFailure: boolean; out?: { terminalPid?: number } }) {
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* launch(layout("interactive"), { models: false, content: "{}" })
        const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
        const location = { directory: process.cwd() }
        const session = yield* Effect.promise(() => client.session.create({ location }))
        const pty = yield* Effect.promise(() =>
          client.experimental.persistentPty.create({
            sessionID: session.id,
            command: "sh",
            args: ["-c", "echo PTY_MARKER_artifact-ok; sleep 30"],
            cwd: process.cwd(),
            title: "portable-pty-smoke",
            env: {},
            size: { cols: 80, rows: 24 },
          }),
        )
        const terminalPid = pty.pid
        if (options.out) options.out.terminalPid = terminalPid
        assert(pty.id, "persistentPty.create must return a pty id")
        assert(terminalPid > 0, "persistentPty must have a live pid")
        // GUARANTEED CLEANUP: every path out of this block (token failure, ws failure, marker
        // timeout, induced failure, or success) shuts the PTY down before the host scope closes,
        // then proves BOTH the terminal child and the artifact daemon are actually dead.
        try {
          if (options.induceFailure) {
            // Deterministic induced failure AFTER create: skip the websocket round-trip and fail,
            // so cleanup must still run (the daemon would otherwise leak on an error path).
            throw new Error("induced failure after PTY create (cleanup must still run)")
          }
          const output = yield* Effect.promise(async () => {
            const tokenRes = await fetch(`${endpoint.url}/api/experimental/persistent-pty/${pty.id}/connect-token`, {
              method: "POST",
              headers: { ...(Service.headers(endpoint) as Record<string, string>), "x-opencode-ticket": "1" },
            })
            const tokenBody = (await tokenRes.json()) as { data?: { ticket?: string } }
            const ticket = tokenBody.data?.ticket
            if (!ticket) throw new Error(`connect-token failed: ${JSON.stringify(tokenBody)}`)
            const wsUrl = new URL(`/api/experimental/persistent-pty/${pty.id}/connect`, endpoint.url)
            wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:"
            wsUrl.searchParams.set("ticket", ticket)
            wsUrl.searchParams.set("attachment_id", "portable-pty-smoke")
            wsUrl.searchParams.set("role", "controller")
            wsUrl.searchParams.set("takeover", "true")
            wsUrl.searchParams.set("input_protocol", "1")
            const socket = new WebSocket(wsUrl)
            const marker = "PTY_MARKER_artifact-ok"
            return await new Promise<string>((resolve, reject) => {
              let buffer = ""
              const timer = setTimeout(() => {
                socket.close()
                reject(new Error(`PTY output timeout; captured: ${JSON.stringify(buffer)}`))
              }, 10000)
              socket.addEventListener("message", (event) => {
                const chunk =
                  typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
                buffer += chunk
                if (buffer.includes(marker)) {
                  clearTimeout(timer)
                  socket.close()
                  resolve(buffer)
                }
              })
              socket.addEventListener("error", (event) => {
                clearTimeout(timer)
                reject(new Error(`PTY websocket error: ${String(event)}`))
              })
              socket.addEventListener("close", (event) => {
                if (!buffer.includes(marker)) {
                  clearTimeout(timer)
                  reject(
                    new Error(
                      `PTY websocket closed (${event.code}) before marker; captured: ${JSON.stringify(buffer.slice(0, 300))}`,
                    ),
                  )
                }
              })
            })
          })
          assert(output.includes("PTY_MARKER_artifact-ok"), `PTY output must contain the command marker:\n${output}`)
        } finally {
          // Cleanup runs on success AND every failure path, before host scope teardown. The
          // shutdown RPC may race the daemon's own teardown, so swallow its error here — the
          // process-death assertions after scope teardown are the real proof.
          yield* Effect.promise(() => client.experimental.persistentPty.shutdown().catch(() => {}))
        }
        return { ptyID: pty.id, terminalPid }
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
  )
  return result
}

async function main() {
  assert(binaryPath, "opencode-pty binaryPath must be defined on darwin-arm64")
  assert(artifactRoot, "KILO_PORTABLE_ARTIFACT_ROOT must point at the relocated artifact")
  const { realpath } = await import("node:fs/promises")
  const binaryReal = await realpath(binaryPath)
  const rootReal = await realpath(artifactRoot)
  assert(
    binaryReal.startsWith(rootReal + "/"),
    `opencode-pty must resolve INSIDE the artifact (${rootReal}), got ${binaryReal}`,
  )

  // PASS 1 (success): full create -> output -> cleanup -> death proof.
  const success = await runPtyOnce({ induceFailure: false })
  await assertPidDead(success.terminalPid, "terminal child")
  await assertNoArtifactDaemon(binaryReal)

  // PASS 2 (induced failure): create -> deterministic failure -> guaranteed cleanup -> death proof.
  const failureOut: { terminalPid?: number } = {}
  let failed = false
  try {
    await runPtyOnce({ induceFailure: true, out: failureOut })
  } catch {
    failed = true
  }
  assert(failed, "induced-failure pass must actually fail")
  assert(failureOut.terminalPid !== undefined, "induced-failure pass must have created the PTY before failing")
  // Even on the failure path, BOTH the terminal child and the artifact daemon must be dead.
  await assertPidDead(failureOut.terminalPid, "terminal child (induced-failure path)")
  await assertNoArtifactDaemon(binaryReal)

  return {
    binary: binaryReal,
    output: "PTY_MARKER_artifact-ok",
    successTerminalPidDead: true,
    inducedFailureCleaned: true,
  }
}

try {
  const result = await main()
  console.log(`KILO_PORTABLE_PTY_SMOKE_OK ${JSON.stringify(result)}`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
