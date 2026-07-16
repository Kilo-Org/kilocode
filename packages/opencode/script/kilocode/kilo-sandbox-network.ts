import { createRequire } from "node:module"
import fs from "node:fs/promises"
import path from "node:path"

const require = createRequire(path.resolve(import.meta.dirname, "../../../kilo-sandbox/package.json"))

export namespace KiloSandboxNetwork {
  export const relay = "kilo-sandbox-network-relay.js"
  export const seccomp = "kilo-sandbox-seccomp"

  export async function bundle() {
    const result = await Bun.build({
      entrypoints: ["../kilo-sandbox/src/kilo-sandbox-network-relay.ts"],
      target: "bun",
      format: "esm",
      minify: true,
    })
    if (!result.success || result.outputs.length !== 1) throw new Error("Could not bundle Kilo sandbox network relay")
    return result.outputs[0]
  }

  export async function copy(worker: Blob, dir: string, arch: "arm64" | "x64") {
    const relayPath = path.join(dir, relay)
    await Bun.write(relayPath, worker)

    const pkg = path.dirname(require.resolve("@anthropic-ai/sandbox-runtime/package.json"))
    const source = path.join(pkg, "vendor", "seccomp", arch, "apply-seccomp")
    const target = path.join(dir, seccomp)
    await fs.copyFile(source, target)
    await fs.chmod(target, 0o755)

    const licenses = path.join(dir, "licenses", "sandbox-runtime")
    await fs.mkdir(licenses, { recursive: true })
    await fs.copyFile(path.join(pkg, "LICENSE"), path.join(licenses, "LICENSE"))
    console.log(`copied Kilo sandbox network relay and seccomp helper to ${dir}`)
  }
}
