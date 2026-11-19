import path from "node:path"
import { KiloSandboxNetwork } from "./kilocode/kilo-sandbox-network"

export async function launcherPostinstall() {
  const script = (await Bun.file(path.resolve(import.meta.dir, "../../cli/script/postinstall.mjs")).text())
    .replaceAll("OpenCode", "Kilo")
    .replaceAll("opencode-install-", "kilo-install-")
  const copied = "    fs.copyFileSync(source, targetBinary)\n  }\n  fs.chmodSync(targetBinary, 0o755)\n"
  if (!script.includes(copied)) throw new Error("postinstall.mjs changed: cannot add the runtime sidecar copy")

  // The macOS renderer and sandbox helpers resolve relative to the installed executable, not the platform package.
  const helpers = [
    "bwrap",
    "licenses",
    "kilo-sandbox-mutation-worker.js",
    "nono",
    KiloSandboxNetwork.relay,
    KiloSandboxNetwork.seccomp,
    "libopentui.dylib",
  ]
  const executables = ["bwrap", "nono", KiloSandboxNetwork.seccomp]
  return script.replace(
    copied,
    copied +
      [
        `  for (const name of ${JSON.stringify(helpers)}) {`,
        "    const from = path.join(path.dirname(source), name)",
        "    if (!fs.existsSync(from)) continue",
        "    const to = path.join(path.dirname(targetBinary), name)",
        "    fs.rmSync(to, { recursive: true, force: true })",
        "    fs.cpSync(from, to, { recursive: true })",
        `    if (${JSON.stringify(executables)}.includes(name)) fs.chmodSync(to, 0o755)`,
        "  }",
        "",
      ].join("\n"),
  )
}
