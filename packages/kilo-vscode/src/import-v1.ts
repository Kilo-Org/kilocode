import { spawn } from "node:child_process"
import { existsSync, readdirSync, renameSync, rmSync } from "node:fs"
import path from "node:path"
import type { Memento, StatusBarItem } from "vscode"
import type { ToHost, ToWebview, V1ImportState } from "./protocol"
import type { Command } from "./server"

/**
 * The Kilo v1 sessions a first start can bring forward, as the CLI reports them: the v1 store it reads, the kilo2 store
 * it would create, and the session count of each. The probe copies nothing.
 */
export type MigrationState = {
  source: string
  sourceSessions: number
  target: string
  targetSessions: number
}

const DONE = "kilo.v2.importV1.done"
const DECLINED = "kilo.v2.importV1.declined"

/**
 * The Kilo v1 session import. The webviews render its state (the chat card and the Settings section), and their
 * buttons call `start`, `later`, `cancel` and `dismiss`. On a first start with Kilo v1 sessions and no Kilo v2 sessions,
 * the server waits until the user chooses, so it cannot create an empty store under the import. The CLI's own startup
 * import stays off in this host (`KILO_DISABLE_V1_IMPORT` in `serverSettings`), so a declined import never runs silently.
 */
export function createMigration(input: {
  command: () => Command | undefined
  env: NodeJS.ProcessEnv
  log: (text: string) => void
  status: StatusBarItem
  memento: Memento
  /** Stops a running server, so the import can move its store aside. The next request starts it on the new store. */
  stop: () => Promise<unknown> | undefined
  /** Sends the state to every webview. */
  notify: (state: V1ImportState) => void
}) {
  const state: {
    current: V1ImportState
    found?: MigrationState
    waiting?: Promise<void>
    release?: () => void
    running?: Promise<void>
    abort?: AbortController
  } = { current: { phase: "none" } }

  const set = (next: V1ImportState) => {
    state.current = next
    paint(input.status, next)
    input.notify(next)
  }

  const refresh = async () => {
    state.found = await probe(input.command(), input.env)
    const found = state.found
    if (!found || found.sourceSessions === 0) return set({ phase: "none" })
    set({
      phase: "available",
      sourceSessions: found.sourceSessions,
      targetSessions: found.targetSessions,
      waiting: state.release !== undefined,
      dismissed: input.memento.get<boolean>(DECLINED) === true,
      imported: input.memento.get<string>(DONE) === found.source,
    })
  }

  const release = () => {
    const done = state.release
    state.release = undefined
    state.waiting = undefined
    done?.()
  }

  const run = async () => {
    const found = state.found ?? (await probe(input.command(), input.env))
    if (!found || found.sourceSessions === 0) return set({ phase: "none" })
    // The CLI only creates a new store, and a running server holds the current one open, even an empty one.
    if (existsSync(found.target)) await input.stop()
    const moved = backup(found.target)
    const abort = new AbortController()
    state.abort = abort
    set({ phase: "copying", sourceSessions: found.sourceSessions })
    const result = await convert(input, found, abort.signal, (converted, total) =>
      set({ phase: "converting", converted, total }),
    ).catch((error: unknown) => {
      input.log(`v1 import failed: ${String(error)}`)
      return error instanceof Error ? error : new Error(String(error))
    })
    state.abort = undefined
    if (typeof result === "number") {
      await input.memento.update(DONE, found.source)
      state.found = undefined
      return set({ phase: "done", imported: result })
    }
    // A cancelled or failed import publishes nothing, so the backed up store goes back to its place.
    clean(found.target)
    restore(moved)
    if (result === undefined) return refresh()
    set({ phase: "failed", message: summary(result.message) })
  }

  return {
    /** The current state, for a webview that asks after it loads. */
    state: () => state.current,
    /**
     * Probes the stores. The server waits from the first call, so a webview that loads at once cannot create a store
     * before the probe answers. On a first start with nothing in Kilo v2 yet, it keeps waiting for the user's choice.
     */
    activate() {
      state.waiting = new Promise<void>((resolve) => (state.release = resolve))
      const settle = () => {
        const current = state.current
        if (current.phase === "available" && current.targetSessions === 0 && !current.dismissed && !current.imported)
          return
        release()
        if (current.phase === "available") set({ ...current, waiting: false })
      }
      void refresh().then(settle, (error: unknown) => {
        input.log(`v1 import probe failed: ${String(error)}`)
        release()
      })
    },
    /** Resolves when no choice or import is pending, so a server never opens the store an import is about to create. */
    async idle() {
      while (state.waiting || state.running) await (state.waiting ?? state.running)
    },
    start() {
      if (state.running) return state.running
      // `run` stops the server, and its stop handlers request a new one at once. Starting `run` a microtask later makes
      // that request see `running` and wait, instead of creating an empty store under the import.
      state.running = Promise.resolve()
        .then(run)
        .finally(() => (state.running = undefined))
      release()
      return state.running
    },
    async later() {
      await input.memento.update(DECLINED, true)
      release()
      await refresh()
    },
    cancel() {
      state.abort?.abort()
    },
    /** Closes the result card. A failed import is not offered again in the chat; Settings still offers it. */
    async dismiss() {
      if (state.current.phase === "failed") await input.memento.update(DECLINED, true)
      await refresh()
    },
  }
}

export type Migration = ReturnType<typeof createMigration>

/** Handles the import card's messages from any webview. Returns true when the message was one of them. */
export function routeV1Import(message: ToHost, migration: Migration | undefined, post: (message: ToWebview) => void) {
  if (!migration) return false
  if (message.type === "v1Import.request") post({ type: "v1Import.state", state: migration.state() })
  else if (message.type === "v1Import.start") void migration.start()
  else if (message.type === "v1Import.later") void migration.later()
  else if (message.type === "v1Import.cancel") migration.cancel()
  else if (message.type === "v1Import.dismiss") void migration.dismiss()
  else return false
  return true
}

/** The status bar mirrors the card, so the import is visible while the Kilo view is closed. */
function paint(status: StatusBarItem, state: V1ImportState) {
  status.command = "kilo-code.v2.chat.focus"
  if (state.phase === "copying") {
    status.text = "$(sync~spin) Kilo: copying v1 sessions"
    status.tooltip = "Kilo is copying the sessions of your earlier Kilo install."
    return status.show()
  }
  if (state.phase === "converting") {
    status.text = `$(sync~spin) Kilo: importing v1 sessions ${state.converted}/${state.total}`
    status.tooltip = "Kilo is importing the sessions of your earlier Kilo install."
    return status.show()
  }
  if (state.phase === "available" && state.waiting) {
    status.text = "$(history) Kilo: import v1 sessions"
    status.tooltip = `Open Kilo to import the ${state.sourceSessions} sessions of your earlier Kilo install.`
    return status.show()
  }
  status.hide()
}

/** The last line of the CLI output names the cause; earlier lines are progress. */
function summary(message: string) {
  return (
    message
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? message
  )
}

/** Reads the store state from the CLI. A missing binary or a failed probe hides the import instead of blocking the host. */
export function probe(command: Command | undefined, env: NodeJS.ProcessEnv): Promise<MigrationState | undefined> {
  if (!command) return Promise.resolve(undefined)
  const args = cli(command, ["import", "v1", "--status"])
  return new Promise((resolve) => {
    const child = spawn(args.cmd, args.args, {
      env: { ...env, ...command.env },
      stdio: ["ignore", "pipe", "ignore"],
    })
    let output = ""
    const stop = setTimeout(() => child.kill(), 20_000)
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()))
    child.on("error", () => {
      clearTimeout(stop)
      resolve(undefined)
    })
    child.on("exit", (code) => {
      clearTimeout(stop)
      resolve(code === 0 ? parseState(output) : undefined)
    })
  })
}

/** The CLI invocation without the server arguments: the bundled binary, or the dev entry script in a checkout. */
function cli(command: Command, rest: string[]) {
  const script = command.env.KILO_V2_PROFILE ? command.args.slice(0, 1) : []
  return { cmd: command.cmd, args: [...script, ...rest] }
}

function parseState(output: string): MigrationState | undefined {
  try {
    const value = JSON.parse(output.trim())
    if (typeof value?.source !== "string" || typeof value?.target !== "string") return undefined
    return {
      source: value.source,
      sourceSessions: Number(value.sourceSessions) || 0,
      target: value.target,
      targetSessions: Number(value.targetSessions) || 0,
    }
  } catch {
    return undefined
  }
}

/** The conversion counter the `import v1` command prints for every chunk of sessions. */
export function importLine(line: string) {
  const match = /^Importing Kilo v1 sessions (\d+)\/(\d+)$/.exec(line)
  if (!match) return undefined
  return { imported: Number(match[1]), total: Number(match[2]) }
}

/** Moves an existing store aside before an import needs the name. The CLI never overwrites a store. */
function backup(target: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return ["", "-wal", "-shm"]
    .map((suffix) => `${target}${suffix}`)
    .filter((file) => existsSync(file))
    .map((file) => {
      const moved = `${file}.before-v1-import-${stamp}`
      renameSync(file, moved)
      return { file, moved }
    })
}

function restore(moved: { file: string; moved: string }[]) {
  for (const entry of moved) if (!existsSync(entry.file)) renameSync(entry.moved, entry.file)
}

/** A cancelled import leaves its private copy and lock behind; the store itself is never published. */
function clean(target: string) {
  const directory = path.dirname(target)
  const prefix = `${path.basename(target)}.`
  const leftover = (name: string) =>
    name.startsWith(prefix) && [".adopt", ".adopt-journal", ".import.lock"].some((end) => name.endsWith(end))
  for (const name of existsSync(directory) ? readdirSync(directory).filter(leftover) : [])
    rmSync(path.join(directory, name), { force: true })
}

/** Runs `import v1` and resolves with the imported session count, or undefined when it was cancelled. */
function convert(
  input: { command: () => Command | undefined; env: NodeJS.ProcessEnv; log: (text: string) => void },
  found: MigrationState,
  signal: AbortSignal,
  progress: (converted: number, total: number) => void,
): Promise<number | undefined> {
  const command = input.command()
  if (!command) return Promise.reject(new Error("No Kilo v2 CLI found."))
  return new Promise((resolve, reject) => {
    const args = cli(command, ["import", "v1", "--from", found.source])
    const child = spawn(args.cmd, args.args, {
      env: { ...input.env, ...command.env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const result: { imported?: number; errors: string } = { errors: "" }
    const line = (text: string) => {
      const match = importLine(text)
      if (match) progress(match.imported, match.total)
      const done = /^Imported (\d+) Kilo v1 sessions/.exec(text)
      if (done) result.imported = Number(done[1])
    }
    const read = (stream: NodeJS.ReadableStream | null, sink: (text: string) => void) => {
      const state = { pending: "" }
      stream?.on("data", (chunk: Buffer) => {
        const lines = (state.pending + chunk.toString()).split(/\r?\n/)
        state.pending = lines.pop() ?? ""
        for (const entry of lines) {
          input.log(`v1 import: ${entry}`)
          sink(entry)
        }
      })
    }
    read(child.stdout, line)
    read(child.stderr, (text) => {
      result.errors = `${result.errors}${text}\n`
      line(text)
    })
    // The copy is one blocking SQLite call, so a process that ignores SIGTERM is killed after a grace period.
    signal.addEventListener("abort", () => {
      child.kill()
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 2_000).unref()
    })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (signal.aborted) return resolve(undefined)
      if (code !== 0) return reject(new Error(result.errors.trim() || `The import stopped (code ${code}).`))
      resolve(result.imported ?? 0)
    })
  })
}
