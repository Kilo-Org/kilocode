import { EOL } from "os"
import path from "path"
import * as prompts from "@clack/prompts"
import { applyEdits, modify, parse as parseJsonc, type ParseError } from "jsonc-parser"
import { Global } from "@opencode-ai/core/global"
import { cmd } from "../../../cli/cmd/cmd"
import { UI } from "../../../cli/ui"
import { Config } from "@/config/config"
import { ConfigMCP } from "@/config/mcp"
import { AppRuntime } from "@/effect/app-runtime"
import { MCP } from "@/mcp"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"

type Scope = "project" | "global"

type AddArgs = {
  name?: string
  commandOrUrl?: string
  args?: string[]
  type?: string
  env?: string | string[]
  header?: string | string[]
  scope?: string
  clientId?: string
  clientSecret?: boolean
  callbackPort?: number
  "--"?: string[]
}

const opts = { formattingOptions: { tabSize: 2, insertSpaces: true } }
const secret = /secret|token|authorization|api[_-]?key|password/i

// Canonical config file names and directory suffixes (mirrors KilocodeConfig constants)
const FILES = ["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json"] as const
const GLOBAL_FILES = [...FILES, "config.json"] as const
const DIRS = [".kilo", ".kilocode", ".opencode"] as const

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function list(input: unknown) {
  if (input === undefined) return []
  if (typeof input === "string") return [input]
  if (Array.isArray(input)) {
    return input.map((item) => {
      if (typeof item !== "string") throw new Error(`Expected string, got ${typeof item}`)
      return item
    })
  }
  throw new Error(`Expected string, got ${typeof input}`)
}

function strings(input: unknown) {
  if (!Array.isArray(input)) return undefined
  const result = input.filter((item): item is string => typeof item === "string")
  if (result.length !== input.length) return undefined
  return result
}

function text(input: unknown) {
  return typeof input === "string" && input.length > 0 ? input : undefined
}

function bool(input: unknown) {
  return typeof input === "boolean" ? input : undefined
}

function num(input: unknown) {
  return typeof input === "number" && Number.isInteger(input) && input > 0 ? input : undefined
}

function map(input: unknown) {
  if (!record(input)) return undefined
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string") return undefined
    result[key] = value
  }
  return result
}

function fields(input: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new Error(`Unsupported MCP JSON field: ${key}`)
  }
}

function split(input: string, sep: string) {
  const index = input.indexOf(sep)
  if (index === -1) return undefined
  const key = input.slice(0, index).trim()
  const value = input.slice(index + sep.length).trim()
  if (!key) return undefined
  return [key, value] as const
}

function pairs(input: unknown, mode: "env" | "header") {
  const result: Record<string, string> = {}
  for (const item of list(input)) {
    const pair = mode === "header" ? split(item, ":") : split(item, "=")
    if (!pair) throw new Error(`Invalid ${mode}: ${item}`)
    result[pair[0]] = pair[1]
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function scope(input: unknown, fallback?: Scope): Scope | undefined {
  if (input === undefined) return fallback
  if (input === "user" || input === "global") return "global"
  if (input === "local" || input === "project") return "project"
  throw new Error(`Invalid scope: ${JSON.stringify(input)}`)
}

/**
 * Walk from `start` up to `stop` (inclusive), returning directories that
 * contain any of `targets`. Mirrors `AppFileSystem.up()` without Effect.
 */
async function up(targets: readonly string[], start: string, stop?: string) {
  const found: string[] = []
  const limit = stop ? path.resolve(stop) : undefined
  let dir = path.resolve(start)
  for (;;) {
    for (const name of targets) {
      if (await Filesystem.exists(path.join(dir, name))) {
        found.push(path.join(dir, name))
        break
      }
    }
    if (limit && dir === limit) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return found
}

/**
 * Resolve the config file to write MCP entries into.
 * Mirrors `KilocodeConfig.projectConfigUpdateTarget()` for project scope
 * and `globalConfigFile()` for global scope.
 */
export async function resolveConfigTarget(type: Scope) {
  if (type === "global") {
    const base = Global.Path.config
    for (const file of GLOBAL_FILES) {
      if (await Filesystem.exists(path.join(base, file))) return path.join(base, file)
    }
    return path.join(base, GLOBAL_FILES[0])
  }
  const dir = process.cwd()
  const stop = Instance.worktree
  const dirs = await up(DIRS, dir, stop)
  const roots = await up(FILES, dir, stop)
  const candidates = [...dirs.flatMap((d) => FILES.map((f) => path.join(d, f))), ...roots]
  for (const file of candidates) {
    if (await Filesystem.exists(file)) return file
  }
  return path.join(dir, ".kilo", "kilo.json")
}

function parse(raw: string, file: string) {
  const errors: ParseError[] = []
  const value = parseJsonc(raw, errors, { allowTrailingComma: true })
  if (errors.length > 0) throw new Error(`Invalid JSON in ${file}`)
  return value
}

async function data(file: string) {
  if (!(await Filesystem.exists(file))) return {}
  return parse(await Filesystem.readText(file), file)
}

async function write(file: string, name: string, cfg: ConfigMCP.Info) {
  const before = (await Filesystem.exists(file)) ? await Filesystem.readText(file) : "{}"
  const edits = modify(before, ["mcp", name], cfg, opts)
  await Filesystem.write(file, applyEdits(before, edits))
  return file
}

async function remove(file: string, name: string) {
  const before = (await Filesystem.exists(file)) ? await Filesystem.readText(file) : "{}"
  const value = parse(before, file)
  if (!record(value) || !record(value.mcp) || !(name in value.mcp)) return false
  const edits = modify(before, ["mcp", name], undefined, opts)
  await Filesystem.write(file, applyEdits(before, edits))
  return true
}

function check(cfg: ConfigMCP.Info) {
  const result = ConfigMCP.Info.zod.safeParse(cfg)
  if (result.success) return result.data
  throw new Error(result.error.issues.map((issue) => issue.message).join("\n"))
}

function oauth(input: {
  clientId?: string
  token?: string
  port?: number
  base?: unknown
}): ConfigMCP.Remote["oauth"] | undefined {
  const base = input.base === false ? false : record(input.base) ? input.base : undefined
  if (base === false) return false
  const result: ConfigMCP.OAuth = {
    ...base,
    ...(input.clientId && { clientId: input.clientId }),
    ...(input.token && { clientSecret: input.token }),
    ...(input.port && { redirectUri: `http://127.0.0.1:${input.port}/mcp/oauth/callback` }),
  }
  return Object.keys(result).length > 0 ? result : undefined
}

export function configFromJson(input: unknown, token?: string): ConfigMCP.Info {
  if (!record(input)) throw new Error("MCP JSON must be an object")

  const kind = text(input.type)
  const enabled = bool(input.enabled)
  const timeout = num(input.timeout)

  if (kind === "local") {
    fields(input, ["type", "command", "environment", "enabled", "timeout"])
    const command = strings(input.command)
    const env = map(input.environment)
    if (!command) throw new Error("local MCP JSON requires command array")
    return check({
      type: "local",
      command,
      ...(env && { environment: env }),
      ...(enabled !== undefined && { enabled }),
      ...(timeout && { timeout }),
    })
  }

  if (kind === "remote") {
    fields(input, ["type", "url", "headers", "oauth", "enabled", "timeout"])
    const url = text(input.url)
    const auth = oauth({ token, base: input.oauth })
    const headers = map(input.headers)
    if (!url) throw new Error("remote MCP JSON requires url")
    if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) throw new Error(`Invalid MCP server URL: ${url}`)
    return check({
      type: "remote",
      url,
      ...(headers && { headers }),
      ...(auth !== undefined && { oauth: auth }),
      ...(enabled !== undefined && { enabled }),
      ...(timeout && { timeout }),
    })
  }

  throw new Error('MCP JSON type must be "local" or "remote"')
}

export function configFromAdd(args: AddArgs, token?: string): ConfigMCP.Info {
  const dash = (args["--"] ?? []).map(String)
  const head = args.commandOrUrl ? [args.commandOrUrl] : []
  const tail = [...(args.args ?? []).map(String), ...dash]
  const command = [...head, ...tail]
  const type = args.type ?? "local"
  if (type !== "local" && type !== "remote") {
    throw new Error(`Invalid MCP server type: ${type}`)
  }

  if (command.length === 0) throw new Error("MCP command or URL is required")

  if (type === "local") {
    if (args.header !== undefined) throw new Error("Headers are only supported for remote MCP servers")
    if (args.clientId !== undefined || args.clientSecret !== undefined || args.callbackPort !== undefined) {
      throw new Error("OAuth options are only supported for remote MCP servers")
    }
    const env = pairs(args.env, "env")
    return check({
      type: "local",
      command,
      ...(env && { environment: env }),
    })
  }

  if (args.env !== undefined) throw new Error("Environment variables are only supported for local MCP servers")
  if (command.length !== 1) throw new Error("Remote MCP servers require exactly one URL")

  const url = command[0]
  const auth = oauth({ clientId: args.clientId, token, port: args.callbackPort })
  const headers = pairs(args.header, "header")
  if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) throw new Error(`Invalid MCP server URL: ${url}`)
  return check({
    type: "remote",
    url,
    ...(headers && { headers }),
    ...(auth !== undefined && { oauth: auth }),
  })
}

async function token(flag?: boolean) {
  if (!flag) return undefined
  if (process.env.MCP_CLIENT_SECRET) return process.env.MCP_CLIENT_SECRET
  const value = await prompts.password({ message: "Enter client secret" })
  if (prompts.isCancel(value)) throw new UI.CancelledError()
  return value
}

async function save(name: string, cfg: ConfigMCP.Info, raw?: string) {
  const file = await resolveConfigTarget(scope(raw, "project") ?? "project")
  await write(file, name, cfg)
  process.stdout.write(`MCP server "${name}" saved to ${file}${EOL}`)
}

export async function handleMcpAddArgs(args: AddArgs) {
  if (!args.name) throw new Error("MCP server name is required")
  const type = args.type ?? "local"
  await save(args.name, configFromAdd(args, type === "remote" ? await token(args.clientSecret) : undefined), args.scope)
}

function redact(input: unknown, key = ""): unknown {
  if (typeof input === "string") return secret.test(key) ? "<redacted>" : input
  if (Array.isArray(input)) return input.map((item) => redact(item, key))
  if (!record(input)) return input
  return Object.fromEntries(Object.entries(input).map(([name, value]) => [name, redact(value, name)]))
}

async function sources(name: string, raw?: string) {
  const wanted = scope(raw)
  const types: Scope[] = wanted ? [wanted] : ["project", "global"]
  const seen = new Set<string>()
  const found: string[] = []
  for (const type of types) {
    const base = type === "global" ? Global.Path.config : Instance.worktree
    const list =
      type === "global"
        ? GLOBAL_FILES.map((f) => path.join(base, f))
        : [
            ...(await up(DIRS, process.cwd(), base)).flatMap((d) => FILES.map((f) => path.join(d, f))),
            ...(await up(FILES, process.cwd(), base)),
          ]
    for (const file of list) {
      if (seen.has(file)) continue
      seen.add(file)
      if (!(await Filesystem.exists(file))) continue
      const value = await data(file)
      if (record(value) && record(value.mcp) && name in value.mcp) found.push(file)
    }
  }
  return found
}

export const McpAddJsonCommand = cmd({
  command: "add-json <name> <json>",
  describe: "add an MCP server from a JSON string",
  builder: (yargs) =>
    yargs
      .positional("name", { describe: "name of the MCP server", type: "string", demandOption: true })
      .positional("json", { describe: "Kilo MCP server JSON", type: "string", demandOption: true })
      .option("scope", {
        alias: "s",
        describe: "configuration scope (local, user, or project)",
        type: "string",
        choices: ["local", "user", "project", "global"],
        default: "local",
      })
      .option("client-secret", {
        describe: "prompt for OAuth client secret or read MCP_CLIENT_SECRET",
        type: "boolean",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const cfg = configFromJson(parse(args.json, "<mcp-json>"), await token(args.clientSecret))
        await save(args.name, cfg, args.scope)
      },
    })
  },
})

export const McpGetCommand = cmd({
  command: "get <name>",
  describe: "get details about an MCP server",
  builder: (yargs) => yargs.positional("name", { describe: "name of the MCP server", type: "string" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const name = args.name
        if (!name) {
          UI.error("MCP server name is required")
          process.exit(1)
        }
        const cfg = await AppRuntime.runPromise(Config.Service.use((svc) => svc.get()))
        const value = cfg.mcp?.[name]
        if (!value) {
          UI.error(`MCP server not found: ${name}`)
          process.exit(1)
        }
        const status = await AppRuntime.runPromise(MCP.Service.use((mcp) => mcp.status()))
        process.stdout.write(JSON.stringify(redact({ name, config: value, status: status[name] }), null, 2) + EOL)
      },
    })
  },
})

export const McpRemoveCommand = cmd({
  command: "remove <name>",
  aliases: ["rm"],
  describe: "remove an MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", { describe: "name of the MCP server", type: "string" })
      .option("scope", {
        alias: "s",
        describe: "configuration scope (local, user, or project)",
        type: "string",
        choices: ["local", "user", "project", "global"],
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const name = args.name
        if (!name) {
          UI.error("MCP server name is required")
          process.exit(1)
        }
        const files = await sources(name, args.scope)
        if (files.length === 0) {
          UI.error(`MCP server not found in config: ${name}`)
          process.exit(1)
        }
        for (const file of files) await remove(file, name)
        process.stdout.write(`Removed MCP server "${name}" from ${files.join(", ")}${EOL}`)
      },
    })
  },
})

