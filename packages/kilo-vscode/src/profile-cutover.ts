import { createInterface } from "node:readline"
import path from "node:path"
import type { ProfileRoots } from "./active-profile"
import { exec, launch } from "./process"
import { environment, type Command } from "./server"

type Input = {
  command: Command | undefined
  cwd: string
  env: NodeJS.ProcessEnv
  settings?: Record<string, string>
  log: (text: string) => void
}

type Inventory = {
  source: string
  backup: string
  sourceBytes: number
  walBytes: number
  availableBytes: number
}

type Progress = { phase: string; done?: number; total?: number }
type Ui = {
  confirm: (inventory: Inventory) => Promise<boolean>
  progress: (run: (report: (event: Progress) => void) => Promise<void>) => PromiseLike<void>
}

/** The activation gate runs before registering anything that can request a server or edit the profile. */
export async function prepareProfile(input: Input, ui: Ui): Promise<false | { profile?: ProfileRoots }> {
  const cli = migrationCli(input)
  const result = await preflight(cli)
  if (result.status === "absent") return {}
  if (result.status === "completed") return { profile: roots(result) }
  const observe = result.status === "running" && result.canObserve === true
  if (!observe && !(await ui.confirm(inventory(result)))) return false
  await ui.progress((report) => stream(cli, observe ? ["observe"] : ["apply", "--accept-jetbrains-breakage"], report))
  return { profile: roots(await preflight(cli)) }
}

/** A lazy start or restart may select a different CLI/profile. Only activation can ask for consent. */
export async function verifyProfile(input: Input, expected?: ProfileRoots) {
  const result = await preflight(migrationCli(input))
  if (result.status === "absent" && !expected) return
  const actual = roots(result)
  if (!expected || Object.entries(actual).some(([key, value]) => value !== expected[key as keyof ProfileRoots]))
    throw new Error("The active Kilo profile changed")
}

function roots(value: Record<string, unknown>): ProfileRoots {
  if (value.status !== "completed") throw new Error(`migrate preflight: ${value.status}`)
  const read = (key: string) => {
    const dir = value[key]
    if (typeof dir !== "string" || !path.isAbsolute(dir)) throw new Error(`migrate preflight: invalid ${key}`)
    return dir
  }
  return { source: read("source"), data: read("legacyData"), config: read("legacyConfig"), state: read("legacyState") }
}

function migrationCli(input: Input) {
  const cmd = input.command
  const serve = cmd?.args.indexOf("serve") ?? -1
  if (!cmd || serve < 0) throw new Error("Cannot resolve the Kilo migration CLI")
  return {
    cmd: cmd.cmd,
    args: [...cmd.args.slice(0, serve), "migrate"],
    options: { cwd: input.cwd, env: environment(input.env, { ...cmd.env, ...input.settings, INIT_CWD: input.cwd }) },
    log: input.log,
  }
}

type Cli = ReturnType<typeof migrationCli>

async function preflight(cli: Cli) {
  const run = await exec(cli.cmd, [...cli.args, "preflight"], cli.options)
  if (run.stderr) cli.log(run.stderr)
  const value = object(run.stdout)
  if (value.version !== 1) throw new Error(`Unsupported migrate preflight version: ${value.version}`)
  switch (value.status) {
    case "absent":
    case "completed":
    case "required":
    case "running":
      return value
    default:
      throw new Error(
        `migrate preflight: ${value.status}${typeof value.message === "string" ? `: ${value.message}` : ""}`,
      )
  }
}

function object(line: string): Record<string, unknown> {
  const value: unknown = JSON.parse(line)
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid migration response")
  return value as Record<string, unknown>
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function inventory(value: Record<string, unknown>): Inventory {
  const { source, backup, sourceBytes, walBytes, availableBytes } = value
  if (typeof source !== "string" || !source || typeof backup !== "string" || !backup)
    throw new Error("Missing migration paths")
  if (!count(sourceBytes) || !count(walBytes) || !count(availableBytes)) throw new Error("Missing migration sizes")
  return { source, backup, sourceBytes, walBytes, availableBytes }
}

function progress(line: string): Progress {
  const { phase, done, total } = object(line)
  if (typeof phase !== "string" || !phase) throw new Error("Invalid migration phase")
  if ((done !== undefined && !count(done)) || (total !== undefined && !count(total)))
    throw new Error("Invalid migration progress")
  return { phase, done, total }
}

async function stream(cli: Cli, args: string[], report: (event: Progress) => void) {
  const child = launch(cli.cmd, [...cli.args, ...args], { ...cli.options, stdio: ["ignore", "pipe", "pipe"] })
  const closed = Promise.withResolvers<void>()
  child.once("error", closed.reject)
  child.once("close", (code, signal) => {
    const status = `migrate ${args[0]}: ${signal ?? `exit ${code}`}`
    cli.log(`${status}\n`)
    if (code === 0) closed.resolve()
    else closed.reject(new Error([status, stderr.trim()].filter(Boolean).join(": ")))
  })
  let stderr = ""
  child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
    cli.log(chunk)
    stderr = (stderr + chunk).slice(-2048)
  })
  // Never terminate an accepted migration because of a bad display event. Drain until the actual exit.
  let invalid: unknown
  const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity })
  lines.on("line", (line) => {
    if (!line.trim()) return
    try {
      const event = progress(line)
      cli.log(`${line}\n`)
      report(event)
    } catch (error) {
      invalid = error
    }
  })
  await closed.promise
  if (invalid) throw invalid
}
