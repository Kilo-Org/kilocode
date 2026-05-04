#!/usr/bin/env bun
/**
 * Build the Kilo VS Code extension and launch it in a development host.
 *
 * Usage:
 *   bun script/launch.ts [options]
 *
 * Options:
 *   --no-build        Skip the build step (reuse last build)
 *   --workspace PATH  Folder to open in VS Code (default: repo root)
 *   --mode dev|vsix   "dev" uses --extensionDevelopmentPath, "vsix" packages a VSIX (default: dev)
 *   --app-path PATH   Explicit path to the VS Code executable (auto-detected if omitted)
 *   --insiders        Prefer VS Code Insiders over stable
 *   --wait            Block until the VS Code window is closed
 *   --clean           Wipe the user-data and extensions dirs before launching
 *   --preserve-settings  Merge defaults into existing VS Code user settings
 *
 * Environment:
 *   VSCODE_EXEC_PATH  Path to VS Code executable (same as --app-path)
 *
 * Cross-platform: macOS, Linux, and Windows are all supported.
 *
 * The script uses a stable directory per repo checkout under the OS temp dir
 * so nothing accumulates — the same dirs are reused on every launch.
 */
import { $ } from "bun"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { delimiter, join, resolve } from "node:path"
import { spawn } from "node:child_process"

const win = process.platform === "win32"
const root = join(import.meta.dir, "..")
const repo = resolve(root, "..", "..")

// Stable per-repo directory under OS temp — no accumulation
const hash = createHash("sha256").update(repo).digest("hex").slice(0, 12)
const base = join(tmpdir(), `kilo-vscode-dev-${hash}`)
const userDir = join(base, "user-data")
const extDir = join(base, "extensions")

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parse(argv: string[]) {
  const result: Record<string, string | boolean> = {}

  for (let i = 0; i < argv.length; i++) {
    const item = argv[i]!
    if (!item.startsWith("--")) continue

    if (item.startsWith("--no-")) {
      result[item.slice(5)] = false
      continue
    }

    const parts = item.slice(2).split("=", 2)
    const key = parts[0]!
    const raw = parts[1]
    if (raw !== undefined) {
      result[key] = raw
      continue
    }

    const next = argv[i + 1]
    if (!next || next.startsWith("--")) {
      result[key] = true
      continue
    }

    result[key] = next
    i++
  }

  return result
}

const opts = parse(process.argv.slice(2))
const shouldBuild = opts["build"] !== false
const mode = (opts["mode"] as string) ?? "dev"
const workspace = opts["workspace"] ? resolve(opts["workspace"] as string) : repo
const insiders = opts["insiders"] === true
const explicit = opts["app-path"] as string | undefined
const blocking = opts["wait"] === true
const clean = opts["clean"] === true
const preserve = opts["preserve-settings"] === true

// ---------------------------------------------------------------------------
// VS Code executable detection
// ---------------------------------------------------------------------------

function which(name: string): string | null {
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean)
  const exts = win ? [".cmd", ".exe", ".bat", ""] : [""]

  for (const dir of paths) {
    for (const ext of exts) {
      const full = join(dir, name.endsWith(ext) ? name : `${name}${ext}`)
      if (existsSync(full)) return full
    }
  }

  return null
}

function detect(): string {
  const env = explicit ?? process.env["VSCODE_EXEC_PATH"]
  if (env && existsSync(env)) return env

  const candidates: string[] = []
  const prefer = insiders ? "insiders" : "stable"

  if (process.platform === "darwin") {
    const order =
      prefer === "insiders"
        ? [
            "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Code - Insiders",
            "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
          ]
        : [
            "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
            "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Code - Insiders",
          ]
    candidates.push(...order)
  }

  if (process.platform === "linux") {
    const stable = [
      "/usr/share/code/code",
      "/usr/bin/code",
      "/snap/code/current/usr/share/code/code",
      "/var/lib/flatpak/exports/bin/com.visualstudio.code",
    ]
    const ins = [
      "/usr/share/code-insiders/code-insiders",
      "/usr/bin/code-insiders",
      "/snap/code-insiders/current/usr/share/code-insiders/code-insiders",
      "/var/lib/flatpak/exports/bin/com.visualstudio.code.insiders",
    ]
    candidates.push(...(prefer === "insiders" ? [...ins, ...stable] : [...stable, ...ins]))
  }

  if (win) {
    const local = process.env["LOCALAPPDATA"] ?? ""
    const program = process.env["PROGRAMFILES"] ?? "C:\\Program Files"

    const stable = [
      join(local, "Programs", "Microsoft VS Code", "Code.exe"),
      join(program, "Microsoft VS Code", "Code.exe"),
    ]
    const ins = [
      join(local, "Programs", "Microsoft VS Code Insiders", "Code - Insiders.exe"),
      join(program, "Microsoft VS Code Insiders", "Code - Insiders.exe"),
    ]
    candidates.push(...(prefer === "insiders" ? [...ins, ...stable] : [...stable, ...ins]))
  }

  const found = candidates.find((c) => existsSync(c))
  if (found) return found

  // Last resort: PATH lookup
  const path = insiders ? (which("code-insiders") ?? which("code")) : (which("code") ?? which("code-insiders"))
  if (path) return path

  console.error(
    `Could not find VS Code. Set VSCODE_EXEC_PATH or pass --app-path.\n` +
      `Searched:\n${candidates.map((c) => `  ${c}`).join("\n")}`,
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// CLI path detection (needed for --mode vsix)
// ---------------------------------------------------------------------------

function codeCli(app: string): string {
  const name = app.toLowerCase().includes("insiders") ? "code-insiders" : "code"
  const direct = which(name)
  if (direct) return direct

  if (process.platform === "darwin") {
    const bundled = app.includes("Insiders")
      ? "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code"
      : "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
    if (existsSync(bundled)) return bundled
  }

  console.error(`VS Code CLI (${name}) not found on PATH. Install the shell command or use --mode dev instead.`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newest(paths: string[]) {
  return [...paths].sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function compile() {
  if (!shouldBuild) {
    console.log("[launch] Skipping build (--no-build)")
    return
  }

  console.log("[launch] Building extension...")
  await $`bun run package`.cwd(root).env(cleanEnv(process.env))
  console.log("[launch] Build complete")
}

function cleanEnv(input: NodeJS.ProcessEnv) {
  const env = { ...input, HOME: homedir().trim() }
  for (const key of ["XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "KILO_TEST_HOME"]) {
    const value = env[key]
    if (value !== undefined) env[key] = value.trim()
  }
  return env
}

// ---------------------------------------------------------------------------
// VSIX packaging (only for --mode vsix)
// ---------------------------------------------------------------------------

async function packageVsix(out: string): Promise<string> {
  await $`bunx vsce package --no-dependencies --skip-license -o ${out}/`.cwd(root)
  const files = newest(
    readdirSync(out)
      .filter((f) => f.endsWith(".vsix"))
      .map((f) => join(out, f)),
  )
  const vsix = files.at(0)
  if (!vsix) {
    console.error(`No VSIX was created in ${out}`)
    process.exit(1)
  }
  return vsix
}

async function installVsix(path: string, app: string) {
  const cmd = codeCli(app)
  await $`${cmd} --extensions-dir ${extDir} --user-data-dir ${userDir} --install-extension ${path} --force`.cwd(root)
}

// ---------------------------------------------------------------------------
// Settings for isolated instance
// ---------------------------------------------------------------------------

function settings(keep: boolean) {
  const dir = join(userDir, "User")
  const file = join(dir, "settings.json")
  const defaults = {
    "editor.accessibilitySupport": "off",
    "extensions.autoCheckUpdates": false,
    "extensions.autoUpdate": false,
    "extensions.ignoreRecommendations": true,
    "security.workspace.trust.enabled": false,
    "task.allowAutomaticTasks": "off",
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": false,
    "window.commandCenter": false,
  }

  mkdirSync(dir, { recursive: true })
  const cfg = keep && existsSync(file) ? { ...defaults, ...load(file) } : defaults

  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n")
}

function load(file: string) {
  try {
    const cfg = JSON.parse(readFileSync(file, "utf8"))
    if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) return cfg as Record<string, unknown>
  } catch (err) {
    console.warn(
      `[launch] Could not parse existing settings.json, rewriting defaults: ${err instanceof Error ? err.message : String(err)}`,
    )
    return {}
  }

  console.warn("[launch] Existing settings.json root is not an object, rewriting defaults")
  return {}
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

async function launch() {
  await compile()

  if (clean) {
    console.log("[launch] Cleaning previous state...")
    rmSync(base, { recursive: true, force: true })
  }

  mkdirSync(userDir, { recursive: true })
  mkdirSync(extDir, { recursive: true })

  const app = detect()

  settings(preserve)

  const args = [workspace, `--extensions-dir=${extDir}`, `--user-data-dir=${userDir}`, "--skip-release-notes"]

  if (mode === "dev") {
    args.push(`--extensionDevelopmentPath=${root}`)
    args.push("--disable-extension=kilocode.kilo-code")
  }

  if (mode === "vsix") {
    const out = join(base, "vsix")
    mkdirSync(out, { recursive: true })
    const vsix = await packageVsix(out)
    await installVsix(vsix, app)
    console.log(`[launch] Installed VSIX: ${vsix}`)
  }

  if (blocking) {
    args.push("--wait")
  }

  // Strip Electron/VS Code env vars so the spawned instance doesn't attach
  // to the current Electron process (e.g. when launched from a VS Code task).
  const env = cleanEnv(process.env)
  for (const key of Object.keys(env)) {
    if (key.startsWith("ELECTRON_") || key.startsWith("VSCODE_")) delete env[key]
  }

  console.log(`[launch] Starting VS Code (${mode} mode)`)
  console.log(`[launch] Executable: ${app}`)
  console.log(`[launch] Workspace:  ${workspace}`)
  console.log(`[launch] State:      ${base}`)

  if (blocking) {
    const result = Bun.spawnSync([app, ...args], {
      cwd: workspace,
      env,
      stdio: ["ignore", "inherit", "inherit"],
    })
    console.log(`[launch] VS Code exited (code ${result.exitCode})`)
    return
  }

  const child = spawn(app, args, {
    cwd: workspace,
    detached: !win,
    env,
    stdio: "ignore",
    ...(win ? { shell: true } : {}),
  })
  child.unref()

  console.log(`[launch] VS Code launched (pid ${child.pid})`)
}

try {
  await launch()
} catch (err) {
  console.error(`[launch] ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
