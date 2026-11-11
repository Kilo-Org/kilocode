export * as KiloLoginService from "./login"

// The OS login unit that starts the background server when the user logs in, so scheduled work runs without a client
// open: a launchd agent on macOS, a systemd user unit on Linux, a logon task on Windows. The unit runs
// `<executable> serve --service`, which exits when a healthy server already runs and registers itself otherwise, so the
// unit needs no singleton logic. `unit` builds each platform's plan as plain data; `install`, `uninstall` and `status`
// execute it with an injected command runner, so tests never call launchctl, systemctl or schtasks.
import { UI } from "@opencode/cli/run/ui"
import { errorMessage } from "@opencode/cli/util/error"
import { OPENCODE_CHANNEL } from "@opencode/cli/version"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { Effect, FileSystem } from "effect"
import { ChildProcess } from "effect/process"
import { existsSync, statSync } from "node:fs"
import path from "node:path"
import { KiloBinary } from "../binary"

export class LoginServiceError extends Error {}

export type Kind = "launchd" | "systemd" | "schtasks"

/** Where the unit goes and whom it runs as. Plain values, so tests can point them at a temporary home. */
export interface Target {
  readonly platform: NodeJS.Platform
  readonly home: string
  /** The global log directory, which receives the launchd agent's output. */
  readonly log: string
  /** XDG_CONFIG_HOME, or ~/.config, which holds the systemd user units. */
  readonly config: string
  readonly uid: number
  /** The app directory and the channel name the unit, so installs of other lines and channels never collide. */
  readonly app: string
  readonly channel: string
}

export interface Install {
  /** The executable and its arguments, ending in `serve --service`. */
  readonly command: ReadonlyArray<string>
  /** PATH at install time. launchd and systemd start units with a minimal PATH that lacks Homebrew and git. */
  readonly path: string | undefined
}

export interface Exec {
  readonly type: "run"
  readonly command: string
  readonly args: ReadonlyArray<string>
  /** Ignore a failure: unloading an agent or unit that is not loaded fails. */
  readonly optional?: boolean
}

export type Step =
  | { readonly type: "directory"; readonly path: string }
  | { readonly type: "write"; readonly path: string; readonly content: string }
  | { readonly type: "remove"; readonly path: string }
  | Exec

export interface Unit {
  readonly kind: Kind
  readonly name: string
  /** The unit file, or for a Windows task, which the Task Scheduler stores itself, the query that finds it. */
  readonly check: { readonly type: "file"; readonly path: string } | Exec
  readonly install: (input: Install) => ReadonlyArray<Step>
  readonly uninstall: ReadonlyArray<Step>
}

export interface State {
  readonly kind: Kind
  readonly name: string
  readonly installed: boolean
}

export type Run = (
  command: string,
  args: ReadonlyArray<string>,
) => Effect.Effect<{ readonly exitCode: number; readonly stderr: string }, Error>

export function unit(target: Target): Unit | undefined {
  const app = safe(target.app)
  const channel = safe(target.channel)
  if (target.platform === "darwin") return launchd(target, `ai.kilo.${app}.${channel}`)
  if (target.platform === "linux")
    return systemd(target, `${app}-${channel}.service`, `Kilo background server (${app} ${channel})`)
  if (target.platform === "win32") return schtasks(`Kilo ${app} ${channel}`)
  return undefined
}

/**
 * The command the unit runs: `executable` when given, otherwise this CLI. A development runner is refused: `bun dev`
 * runs a checkout, and the unit would start whatever that checkout holds at every login.
 */
export function resolveCommand(input: { readonly executable?: string; readonly self: () => ReadonlyArray<string> }) {
  if (input.executable !== undefined) {
    const candidate = input.executable
    // A path is checked as a file; a bare name is resolved on PATH. Bun.which also accepts paths, but on Windows it
    // rejects an absolute path without an executable extension, which a `--command` path may be.
    const isPath = candidate.includes("/") || candidate.includes("\\") || path.isAbsolute(candidate)
    const found = isPath
      ? executableFile(candidate)
        ? path.resolve(candidate)
        : null
      : Bun.which(candidate)
    if (found === null) throw new LoginServiceError(`--command ${input.executable} is not an executable file.`)
    return [found, "serve", "--service"]
  }
  const self = input.self()
  if (developmentRunner(self))
    throw new LoginServiceError(
      `This is a development build (${self.join(" ")}), which cannot start at login. ` +
        `Install the packaged ${KiloBinary} CLI and run \`${KiloBinary} service install\` with it, ` +
        "or pass --command <path> with the executable to start at login.",
    )
  return [...self, "serve", "--service"]
}

export function developmentRunner(command: ReadonlyArray<string>) {
  const runtime = (command[0] ?? "").split(/[\\/]/).pop()?.toLowerCase()
  return runtime === "bun" || runtime === "bun.exe" || command.slice(1).some((arg) => /\.tsx?$/i.test(arg))
}

function executableFile(file: string) {
  if (!existsSync(file) || !statSync(file).isFile()) return false
  // Windows has no executable bit; the file existence check is the strongest portable signal there.
  return process.platform === "win32" || (statSync(file).mode & 0o111) !== 0
}

export function plist(input: {
  readonly label: string
  readonly command: ReadonlyArray<string>
  readonly path: string | undefined
  readonly home: string
  readonly log: string
}) {
  const string = (value: string) => `<string>${escapeXml(value)}</string>`
  // A launchd plist is macOS text: keep POSIX separators even when the value is built on another host for tests.
  const output = `${input.log.replaceAll("\\", "/").replace(/\/+$/, "")}/${input.label}.log`
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  ${string(input.label)}`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    ...input.command.map((arg) => `    ${string(arg)}`),
    `  </array>`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    // Restart only after a crash: `serve --service` exits 0 when a server already runs, and restarting it would loop.
    `  <key>KeepAlive</key>`,
    `  <dict>`,
    `    <key>SuccessfulExit</key>`,
    `    <false/>`,
    `  </dict>`,
    `  <key>ProcessType</key>`,
    `  <string>Background</string>`,
    ...(input.path
      ? [`  <key>EnvironmentVariables</key>`, `  <dict>`, `    <key>PATH</key>`, `    ${string(input.path)}`, `  </dict>`]
      : []),
    `  <key>WorkingDirectory</key>`,
    `  ${string(input.home)}`,
    `  <key>StandardOutPath</key>`,
    `  ${string(output)}`,
    `  <key>StandardErrorPath</key>`,
    `  ${string(output)}`,
    `</dict>`,
    `</plist>`,
    ``,
  ].join("\n")
}

export function systemdUnit(input: {
  readonly description: string
  readonly command: ReadonlyArray<string>
  readonly path: string | undefined
}) {
  return [
    `[Unit]`,
    `Description=${input.description}`,
    ``,
    `[Service]`,
    `ExecStart=${input.command.map((arg) => quoteSystemd(arg, true)).join(" ")}`,
    `Restart=on-failure`,
    `WorkingDirectory=%h`,
    ...(input.path ? [`Environment=${quoteSystemd(`PATH=${input.path}`, false)}`] : []),
    ``,
    `[Install]`,
    `WantedBy=default.target`,
    ``,
  ].join("\n")
}

/** The schtasks `/TR` value: the quoted executable, then its arguments, quoted where they contain whitespace. */
export function taskCommand(command: ReadonlyArray<string>) {
  return command.map((arg, index) => (index === 0 || /\s/.test(arg) ? `"${arg}"` : arg)).join(" ")
}

/** Writes or replaces the unit and starts it. */
export const install = Effect.fn("KiloLoginService.install")(function* (target: Target, input: Install, run: Run) {
  const found = yield* supported(target)
  yield* execute(found.install(input), run)
  return { kind: found.kind, name: found.name, installed: true } satisfies State
})

/** Stops and removes the unit. Nothing runs when it is not installed. */
export const uninstall = Effect.fn("KiloLoginService.uninstall")(function* (target: Target, run: Run) {
  const found = yield* supported(target)
  const installed = yield* exists(found, run)
  if (installed) yield* execute(found.uninstall, run)
  return { kind: found.kind, name: found.name, removed: installed }
})

export const status = Effect.fn("KiloLoginService.status")(function* (target: Target, run: Run) {
  const found = yield* supported(target)
  return { kind: found.kind, name: found.name, installed: yield* exists(found, run) } satisfies State
})

export function describe(state: State) {
  return state.installed ? `login: installed (${state.kind}, ${state.name})` : "login: not installed"
}

/** This process's target: the global home and log directory, the user, and the app directory and channel. */
export const target = Effect.gen(function* () {
  const global = yield* Global.Service
  return {
    platform: process.platform,
    home: global.home,
    log: global.log,
    config: process.env.XDG_CONFIG_HOME || path.join(global.home, ".config"),
    uid: process.getuid?.() ?? 0,
    app: process.env.OPENCODE_APP_DIR_NAME || "opencode",
    channel: OPENCODE_CHANNEL,
  } satisfies Target
})

/** Runs launchctl, systemctl and schtasks for real. */
export const processRunner = Effect.gen(function* () {
  const appProcess = yield* AppProcess.Service
  const run: Run = (command, args) =>
    appProcess
      .run(ChildProcess.make(command, args, { stdin: "ignore" }), {
        timeout: "30 seconds",
        maxOutputBytes: 65_536,
        maxErrorBytes: 65_536,
      })
      .pipe(Effect.map((result) => ({ exitCode: result.exitCode, stderr: result.stderr.toString("utf8") })))
  return run
})

/** Prints the failure as `Error: <message>` and sets a failing exit code. */
export const report = (error: unknown) =>
  Effect.sync(() => {
    UI.error(errorMessage(error))
    process.exitCode = 1
  })

function launchd(target: Target, label: string): Unit {
  const domain = `gui/${target.uid}`
  const file = path.join(target.home, "Library", "LaunchAgents", `${label}.plist`)
  // Unloading first lets a reinstall replace a loaded agent.
  const bootout: Exec = { type: "run", command: "launchctl", args: ["bootout", `${domain}/${label}`], optional: true }
  return {
    kind: "launchd",
    name: label,
    check: { type: "file", path: file },
    install: (input) => [
      { type: "directory", path: target.log },
      {
        type: "write",
        path: file,
        content: plist({ label, command: input.command, path: input.path, home: target.home, log: target.log }),
      },
      bootout,
      { type: "run", command: "launchctl", args: ["bootstrap", domain, file] },
    ],
    uninstall: [bootout, { type: "remove", path: file }],
  }
}

function systemd(target: Target, name: string, description: string): Unit {
  const file = path.join(target.config, "systemd", "user", name)
  return {
    kind: "systemd",
    name,
    check: { type: "file", path: file },
    install: (input) => [
      { type: "write", path: file, content: systemdUnit({ description, command: input.command, path: input.path }) },
      { type: "run", command: "systemctl", args: ["--user", "daemon-reload"] },
      { type: "run", command: "systemctl", args: ["--user", "enable", "--now", name] },
    ],
    uninstall: [
      { type: "run", command: "systemctl", args: ["--user", "disable", "--now", name], optional: true },
      { type: "remove", path: file },
      { type: "run", command: "systemctl", args: ["--user", "daemon-reload"], optional: true },
    ],
  }
}

function schtasks(name: string): Unit {
  return {
    kind: "schtasks",
    name,
    check: { type: "run", command: "schtasks", args: ["/Query", "/TN", name] },
    install: (input) => [
      {
        type: "run",
        command: "schtasks",
        args: ["/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED", "/TN", name, "/TR", taskCommand(input.command)],
      },
    ],
    uninstall: [{ type: "run", command: "schtasks", args: ["/Delete", "/F", "/TN", name] }],
  }
}

function supported(target: Target) {
  const found = unit(target)
  if (found === undefined)
    return Effect.fail(new LoginServiceError(`Starting the background server at login is not supported on ${target.platform}.`))
  return Effect.succeed(found)
}

const exists = Effect.fnUntraced(function* (found: Unit, run: Run) {
  if (found.check.type === "run") return (yield* run(found.check.command, found.check.args)).exitCode === 0
  const fs = yield* FileSystem.FileSystem
  return yield* fs.exists(found.check.path)
})

function execute(steps: ReadonlyArray<Step>, run: Run) {
  return Effect.forEach(steps, (step) => perform(step, run), { discard: true })
}

const perform = Effect.fnUntraced(function* (step: Step, run: Run) {
  const fs = yield* FileSystem.FileSystem
  if (step.type === "directory") return yield* fs.makeDirectory(step.path, { recursive: true })
  if (step.type === "write") {
    yield* fs.makeDirectory(path.dirname(step.path), { recursive: true })
    return yield* fs.writeFileString(step.path, step.content)
  }
  if (step.type === "remove") return yield* fs.remove(step.path, { force: true })
  if (step.optional) return yield* Effect.ignore(run(step.command, step.args))
  const result = yield* run(step.command, step.args)
  if (result.exitCode === 0) return
  const detail = result.stderr.trim()
  return yield* Effect.fail(
    new LoginServiceError(
      `\`${[step.command, ...step.args].join(" ")}\` failed with exit code ${result.exitCode}${detail ? `: ${detail}` : ""}`,
    ),
  )
})

function safe(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-")
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// systemd unescapes C-style quoted strings and expands % specifiers in both settings; ExecStart also expands $NAME.
function quoteSystemd(value: string, variables: boolean) {
  const escaped = value.replace(/[\\"]/g, (char) => `\\${char}`).replace(/%/g, "%%")
  return `"${variables ? escaped.replace(/\$/g, () => "$$") : escaped}"`
}
