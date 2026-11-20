import path from "node:path"
import { KiloSandboxNetwork } from "./kilocode/kilo-sandbox-network"

const registry = "https://registry.npmjs.org"

export async function launcherPostinstall() {
  const source = await Bun.file(path.resolve(import.meta.dir, "../../cli/script/postinstall.mjs")).text()
  return transformPostinstall(source)
}

export function transformPostinstall(source: string) {
  const script = source.replaceAll("OpenCode", "Kilo").replaceAll("opencode-install-", "kilo-install-")
  const copied = "    fs.copyFileSync(source, targetBinary)\n  }\n  fs.chmodSync(targetBinary, 0o755)\n"
  const install = '        "--loglevel=error",'
  const verification = [
    "function verifyBinary() {",
    '  const result = childProcess.spawnSync(targetBinary, ["--version"], {',
    '    encoding: "utf8",',
    "    windowsHide: true,",
    "  })",
    '  return result.status === 0 && `${result.stdout || ""}`.trim() === `kilo2 v${packageJson.version}`',
    "}",
  ].join("\n")
  const verify = [
    "function verifyBinary() {",
    "  return (",
    '    childProcess.spawnSync(targetBinary, ["--version"], {',
    '      stdio: "ignore",',
    "      windowsHide: true,",
    "    }).status === 0",
    "  )",
    "}",
  ].join("\n")

  // The macOS renderer and sandbox helpers resolve relative to the installed executable, not the platform package.
  const helpers = [
    "bwrap",
    "licenses",
    "kilo-sandbox-mutation-worker.js",
    KiloSandboxNetwork.relay,
    KiloSandboxNetwork.seccomp,
    "libopentui.dylib",
    "tree-sitter",
  ]
  const executables = ["bwrap", KiloSandboxNetwork.seccomp]
  const generated = replaceOnce(
    replaceOnce(
      replaceOnce(
        script,
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
        "add the runtime sidecar copy",
      ),
      install,
      // The fallback runs its own npm, so the outer manager's flags and any npmrc must not choose the source.
      [
        install,
        `        ${JSON.stringify(`--registry=${registry}`)},`,
        `        ${JSON.stringify(`--@kilocode:registry=${registry}`)},`,
      ].join("\n"),
      "pin the fallback install registry",
    ),
    verify,
    verification,
    "verify the installed launcher version",
  )
  // Keep the nested install on the exact version declared by the launcher, not a tag or range.
  requireOnce(generated, "        `${name}@${dependencies[name]}`,", "pin the fallback install version")
  return generated
}

function replaceOnce(script: string, anchor: string, replacement: string, description: string) {
  requireOnce(script, anchor, description)
  return script.replace(anchor, replacement)
}

function requireOnce(script: string, anchor: string, description: string) {
  if (script.split(anchor).length !== 2) throw new Error(`postinstall.mjs changed: cannot ${description}`)
}
