import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import tls from "node:tls"
import { host, pin, stage, target } from "./bun"

export function code(err: unknown): string {
  if (err && typeof err === "object") {
    if ("code" in err && err.code === "CERT_REVOKED") return err.code
    if ("cause" in err && err.cause !== err && code(err.cause) === "CERT_REVOKED") return "CERT_REVOKED"
    if ("code" in err) return String(err.code)
  }
  return String(err)
}

// An unavailable endpoint is inconclusive, never proof of certificate rejection.
export function check(results: { fetch: string; tls: string }[], control: boolean, optional = false) {
  if (results.some((item) => item.fetch.startsWith("TRUSTED_HTTP_") || item.tls === "TRUSTED")) {
    throw new Error("Bun trusted a compromised certificate chain")
  }
  if (
    control &&
    results.length > 0 &&
    results.every((item) => item.fetch === "CERT_REVOKED" && item.tls === "CERT_REVOKED")
  ) {
    return true
  }
  if (!optional) throw new Error("Bun certificate revocation probe is inconclusive")
  return false
}

async function probe(optional: boolean) {
  if (Bun.revision !== pin.revision) throw new Error(`Expected Bun revision ${pin.revision}, got ${Bun.revision}`)
  console.log(`Checking Bun ${pin.version} (${Bun.revision})`)
  const control = await fetch("https://example.com/", { signal: AbortSignal.timeout(10000) }).then(
    async (res) => {
      await res.body?.cancel()
      console.log(`Normal HTTPS: HTTP ${res.status}`)
      return res.ok
    },
    (err: unknown) => {
      console.warn(`Normal HTTPS unavailable: ${code(err)}`)
      return false
    },
  )

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
      }).then(async (res) => {
        await res.body?.cancel()
        return `TRUSTED_HTTP_${res.status}`
      }, code)
      const deferred = Promise.withResolvers<string>()
      const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: true })
      socket.setTimeout(10000, () => socket.destroy(new Error("TLS_TIMEOUT")))
      socket.once("secureConnect", () => {
        deferred.resolve("TRUSTED")
        socket.destroy()
      })
      socket.once("error", (err: Error) => deferred.resolve(code(err)))
      socket.once("close", () => deferred.resolve("TLS_CLOSED"))
      const status = await deferred.promise
      console.log(`${host}: fetch=${result}, node:tls=${status}`)
      return { fetch: result, tls: status }
    }),
  )
  if (check(results, control, optional)) {
    console.log("Rejected all 12 compromised chains through fetch and node:tls; normal HTTPS succeeded")
    return
  }
  console.warn(
    "::warning::Bun certificate revocation probe is inconclusive; check endpoint availability and TLS diagnostics",
  )
}

if (import.meta.main) {
  const optional = process.argv.includes("--allow-unavailable")
  const input = host()
  console.log(`Selected Bun runtime artifact: ${target(input).name}`)
  await probe(optional)
  if (!process.argv.includes("--compiled")) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-bun-probe-"))
    try {
      const runtime = await stage(input)
      const file = path.join(dir, process.platform === "win32" ? "probe.exe" : "probe")
      await Bun.build({
        entrypoints: [import.meta.filename],
        compile: { outfile: file, executablePath: runtime, execArgv: ["--use-system-ca", "--"] },
      })
      const child = Bun.spawn([file, "--compiled", ...(optional ? ["--allow-unavailable"] : [])], {
        stdout: "inherit",
        stderr: "inherit",
        windowsHide: true,
      })
      if ((await child.exited) !== 0) throw new Error("Compiled Bun TLS probe failed")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
}
