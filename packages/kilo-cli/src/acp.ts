import path from "node:path"

export type AcpEndpoint = {
  readonly url: string
  readonly auth: { readonly username?: string; readonly password: string }
}

export type AcpOptions = {
  readonly artifact?: string
  readonly signal?: AbortSignal
  readonly cwd?: string
}

const forceKillMs = 3000

/**
 * Run the Kilo ACP bridge against an endpoint the caller already owns. The
 * bridge is a prebuilt artifact with its own Bun runtime, so this process never
 * imports the wrapped CLI package and never starts, discovers, or stops a
 * server. Resolves with the bridge's exit code.
 */
export async function runAcp(endpoint: AcpEndpoint, options: AcpOptions = {}) {
  const artifact = options.artifact ? path.resolve(options.artifact) : path.resolve(import.meta.dir, "../dist/acp")
  const runtime = path.join(artifact, process.platform === "win32" ? "bun.exe" : "bun")
  const bundle = path.join(artifact, "acp.js")
  for (const file of [runtime, bundle]) {
    if (!(await Bun.file(file).exists())) {
      throw new Error(`Missing the Kilo ACP bridge artifact: ${file}. Build it with: bun run script/build-acp.ts`)
    }
  }
  const child = Bun.spawn([runtime, "--no-env-file", bundle], {
    cwd: options.cwd ?? process.cwd(),
    // Explicit entries win over inherited ones, so an exported value cannot
    // shadow the caller's endpoint. The credential never reaches argv or a log.
    env: {
      ...process.env,
      KILO_ACP_SERVER_URL: endpoint.url,
      KILO_ACP_SERVER_USERNAME: endpoint.auth.username ?? "opencode",
      KILO_ACP_SERVER_PASSWORD: endpoint.auth.password,
    },
    // Our stdio is the ACP transport, so the bridge owns it directly: no proxy
    // layer to reorder or drop frames, and stdin EOF reaches the bridge as EOF.
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  // Repeat signals must not arm a second escalation timer: `finally` can only
  // clear the handle it can see, and the orphan would outlive the child.
  const stop = () => {
    if (timer || child.exitCode !== null || child.signalCode !== null) return
    child.kill("SIGTERM")
    timer = setTimeout(() => child.kill("SIGKILL"), forceKillMs)
    timer.unref()
  }
  options.signal?.addEventListener("abort", stop)
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  try {
    if (options.signal?.aborted) stop()
    return await child.exited
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", stop)
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
  }
}
