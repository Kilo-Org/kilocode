import path from "node:path"
import fs from "node:fs/promises"
import os from "node:os"
import { spawn } from "node:child_process"
import { ENTRY, MANIFEST } from "../src/daemon/build"

type Artifact = Blob & { path?: string; kind?: string }

export namespace WorldDaemon {
  export const filename = ENTRY
  export const manifest = MANIFEST

  export type Bundle = { entry: Artifact; files: Artifact[] }

  export async function bundle(): Promise<Bundle> {
    const entry = path.resolve(import.meta.dirname, "../src/daemon/entry.ts")
    const result = await Bun.build({
      entrypoints: [entry],
      target: "node",
      format: "cjs",
      minify: true,
      external: ["chromium-bidi", "electron"],
    })
    if (!result.success) {
      const details = result.logs.map((item) => String(item)).join("\n")
      throw new Error(`Could not bundle kilo-world daemon:\n${details}`)
    }
    const files = result.outputs as Artifact[]
    const output =
      files.find((item) => item.kind === "entry-point") ??
      files.find((item) => item.path?.endsWith("/entry.js") || item.path?.endsWith("\\entry.js")) ??
      files[0]
    if (!output) throw new Error("kilo-world daemon bundle produced no outputs")
    return { entry: output, files }
  }

  export async function copy(bundle: Bundle, dir: string): Promise<string> {
    await Bun.write(path.join(dir, filename), bundle.entry)
    const names = new Set([filename])
    for (const file of bundle.files) {
      if (file === bundle.entry || !file.path) continue
      const name = path.basename(file.path)
      names.add(name)
      await Bun.write(path.join(dir, name), file)
    }
    await Bun.write(path.join(dir, manifest), `${JSON.stringify([...names], null, 2)}\n`)
    return path.join(dir, filename)
  }

  export async function smoke(file: string, dir?: string): Promise<void> {
    const node = Bun.which("node")
    if (!node) throw new Error("Node is required to smoke-test the kilo-world daemon")
    const root = dir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "kilo-world-build-")))
    await fs.mkdir(root, { recursive: true })
    const session = `smoke-${process.pid}`
    const handshake = path.join(root, `daemon-${session}.json`)
    const child = spawn(node, [file, `--session=${session}`, "--idle=15000"], {
      env: {
        ...process.env,
        KILO_WORLD_HOME: root,
        KILO_WORLD_DAEMON_SILENT: "1",
        KILO_WORLD_PARENT_PID: String(process.pid),
      },
      stdio: ["ignore", "ignore", "inherit"],
      windowsHide: true,
    })
    try {
      for (const _ of Array.from({ length: 100 })) {
        if (await Bun.file(handshake).exists()) break
        if (child.exitCode !== null) throw new Error(`kilo-world daemon exited ${child.exitCode} during smoke test`)
        await Bun.sleep(50)
      }
      if (!(await Bun.file(handshake).exists())) throw new Error("kilo-world daemon smoke test timed out")
      const data: unknown = JSON.parse(await Bun.file(handshake).text())
      if (!record(data) || typeof data.url !== "string" || typeof data.token !== "string") {
        throw new Error("kilo-world daemon wrote an invalid smoke-test handshake")
      }
      const status = await fetch(`${data.url}/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "smoke", verb: "__status__", args: [], auth: data.token }),
      }).then((response) => response.json())
      if (!record(status) || !record(status.envelope) || status.envelope.runtime !== "node") {
        throw new Error("kilo-world daemon smoke test did not run under Node")
      }
      await fetch(`${data.url}/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "stop", verb: "__shutdown__", args: [], auth: data.token }),
      })
      for (const _ of Array.from({ length: 100 })) {
        if (child.exitCode !== null) break
        await Bun.sleep(50)
      }
      if (child.exitCode === null) throw new Error("kilo-world daemon did not stop after smoke test")
    } finally {
      if (child.exitCode === null) child.kill()
      await fs.rm(root, { recursive: true, force: true })
    }
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
