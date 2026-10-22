import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import tls from "node:tls"
import { pin, stage } from "./bun"

// Require a certificate rejection, not a timeout or a general connection failure.
async function probe() {
  if (Bun.revision !== pin.revision) throw new Error(`Expected Bun revision ${pin.revision}, got ${Bun.revision}`)
  console.log(`Checking Bun ${pin.version} (${Bun.revision})`)
  const control = await fetch("https://example.com/", { signal: AbortSignal.timeout(10000) })
  await control.body?.cancel()
  if (!control.ok) throw new Error(`Normal HTTPS failed: HTTP ${control.status}`)

  const hosts = ["dv", "ov", "ev"].flatMap((kind) =>
    ["g3b", "g3c"].flatMap((region) =>
      ["emudhra", "aaa-emudhra"].map((root) => `${kind}-${region}-${root}.we-have-a-problem.com`),
    ),
  )
  const results = await Promise.all(
    hosts.map(async (host) => {
      const result = await fetch(`https://${host}/`, {
        signal: AbortSignal.timeout(10000),
        redirect: "manual",
      }).then(
        async (res) => {
          await res.body?.cancel()
          return `TRUSTED_HTTP_${res.status}`
        },
        (err: unknown) => (err instanceof Error && "code" in err ? String(err.code) : String(err)),
      )
      const deferred = Promise.withResolvers<string>()
      const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: true })
      socket.setTimeout(10000, () => socket.destroy(new Error("TLS_TIMEOUT")))
      socket.once("secureConnect", () => {
        deferred.resolve("TRUSTED")
        socket.destroy()
      })
      socket.once("error", (err: Error) => deferred.resolve("code" in err ? String(err.code) : err.message))
      socket.once("close", () => deferred.resolve("TLS_CLOSED"))
      const code = await deferred.promise
      console.log(`${host}: fetch=${result}, node:tls=${code}`)
      return result === "CERT_REVOKED" && code === "CERT_REVOKED"
    }),
  )
  if (!results.every(Boolean)) throw new Error("Bun did not reject every compromised certificate chain")
  console.log("Rejected all 12 compromised chains through fetch and node:tls; normal HTTPS succeeded")
}

await probe()
if (!process.argv.includes("--compiled")) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-bun-probe-"))
  try {
    const runtime = await stage({
      os: process.platform,
      arch: process.arch,
      avx2: process.arch === "x64" ? false : undefined,
    })
    const file = path.join(dir, process.platform === "win32" ? "probe.exe" : "probe")
    await Bun.build({
      entrypoints: [import.meta.filename],
      compile: { outfile: file, executablePath: runtime, execArgv: ["--use-system-ca", "--"] },
    })
    const child = Bun.spawn([file, "--compiled"], { stdout: "inherit", stderr: "inherit", windowsHide: true })
    if ((await child.exited) !== 0) throw new Error("Compiled Bun TLS probe failed")
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
